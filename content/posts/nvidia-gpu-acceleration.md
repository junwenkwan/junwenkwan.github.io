+++
date = '2026-03-09'
draft = false
title = 'GPU Acceleration with the C++ Standard Libray'
tags = ['c++']
math = true
+++

This post is based on [this self-paced course](https://learn.nvidia.com/courses/course-detail?course_id=course-v1:DLI+S-AC-08+V1) offered by NVIDIA's Deep Learning Institute.

NVIDIA's **stdpar** lets you offload standard C++20 algorithms onto the GPU without CUDA kernels or new syntax. To show how this works in practice, we'll use **DAXPY**, which is a simple but memory-intensive linear algebra operation, and see how a few small code changes take it from a single-threaded CPU loop to full GPU execution.

## DAXPY as a Bandwidth Benchmark

DAXPY stands for **D**ouble-precision **A**X **P**lus **Y**, and it computes the following equation.

$$y_i = a \cdot x_i + y_i \quad \forall i$$

It's essentially memory-bandwidth-bound and the bottleneck is data movement and not arithmetic. That makes it a reliable way to measure peak memory throughput. Each iteration reads `x[i]` and `y[i]`, then writes `y[i]`, so effective bandwidth is:

$$\text{Bandwidth} = \frac{3 \times N \times 8 \text{ bytes}}{t}$$


## Starting with a Sequential Loop

A plain for-loop is the natural starting point:

```cpp
void daxpy(double a, std::vector<double> const &x, std::vector<double> &y)
{
    for (std::size_t i = 0; i < x.size(); ++i)
    {
        y[i] += a * x[i];
    }
}
```

This is correct and readable, but it is only limited to one CPU core.

Both `g++` and `nvc++` can compile this, but they are different tools for different purposes. `g++` is the standard GNU C++ compiler, while `nvc++` is NVIDIA's C++ compiler that supports GPU offloading via `-stdpar=gpu`. For CPU-only code like this, you can benchmark both:

```bash
# Compile and run with g++
g++ -std=c++20 -Ofast -march=native -DNDEBUG -o daxpy daxpy.cpp
./daxpy 1000000

# Compile and run with nvc++
nvc++ -std=c++20 -O4 -fast -march=native -Mllvm-fast -DNDEBUG -o daxpy daxpy.cpp
./daxpy 1000000
```

At this stage both produce CPU-only binaries, the GPU offloading only kicks in when `par_unseq` is combined with `-stdpar=gpu` in a later step.

## Switching to Standard Algorithms

The raw for-loop works, but it can't be parallelised directly. The key insight behind C++17 execution policies is that parallelism is opted in at the call site by passing a policy tag but the logic itself doesn't change. So the first step is to rewrite the loops using standard algorithms with `std::execution::seq`, keeping identical behaviour:

```cpp
#include <algorithm>
#include <execution>
#include <ranges>

void initialize(std::vector<double> &x, std::vector<double> &y)
{
    std::for_each_n(std::execution::seq,
                    std::views::iota(0LL).begin(),
                    x.size(),
                    [&](long long i) { x[i] = (double)i; });
    std::fill_n(std::execution::seq, y.begin(), y.size(), 2.0);
}

void daxpy(double a, std::vector<double> const &x, std::vector<double> &y)
{
    std::transform(std::execution::seq,
                   x.begin(),
                   x.end(),
                   y.begin(),
                   y.begin(),
                   [a](double xi, double yi) { return yi + a * xi; });
}
```

`std::views::iota(0LL)` provides a lazy index range so each iteration writes to a unique element. The result is functionally identical to the for-loop, but now structured to accept a different execution policy.

## Offloading to the GPU with `par_unseq`

This is where it pays off. The only change from the previous version is replacing every `std::execution::seq` with `std::execution::par_unseq`:

```cpp
void initialize(std::vector<double> &x, std::vector<double> &y)
{
    std::for_each_n(std::execution::par_unseq,
                    std::views::iota(0).begin(),
                    x.size(),
                    [&x](int i) { x[i] = (double)i; });
    std::fill_n(std::execution::par_unseq,
                y.begin(),
                y.size(),
                2.);
}

void daxpy(double a, std::vector<double> const &x, std::vector<double> &y)
{
    std::transform(std::execution::par_unseq,
                   x.begin(),
                   x.end(),
                   y.begin(),
                   y.begin(),
                   [a](double x, double y) { return a * x + y; });
}
```

`par_unseq` tells the compiler that iterations are independent, there is no data race, and it can safely run in parallel with SIMD vectorization. However, it is the programmer's responsibility to ensure this holds, as the compiler does not verify it. When compiled with NVIDIA's `nvc++` and the `-stdpar=gpu` flag, these calls are automatically offloaded to the GPU without writing any CUDA code.

```bash
# g++ stays on CPU, par_unseq is a no-op without -ltbb
g++ -std=c++20 -Ofast -march=native -DNDEBUG -o daxpy daxpy.cpp
./daxpy 100000000

# nvc++ offloads to GPU with -stdpar=gpu
nvc++ -std=c++20 -O4 -fast -march=native -Mllvm-fast -DNDEBUG -stdpar=gpu -o daxpy daxpy.cpp
./daxpy 100000000
```

The compiler takes care of GPU memory management, kernel launches, and synchronisation. No CUDA is required for this usage.

## Key Takeaways

- **No new language**: execution policies are part of the C++17 standard.
- **Portability**: the same source compiles for CPU or GPU; only the compiler flag changes.
- **Incremental**: you can accelerate one bottleneck at a time without rewriting everything.

The one thing to keep in mind is that lambdas passed to GPU-offloaded algorithms must only access GPU-accessible memory. And with nvc++, `std::vector` allocations are handled automatically via CUDA managed memory.