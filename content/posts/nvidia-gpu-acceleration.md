+++
date = '2026-03-09'
draft = false
title = 'GPU Acceleration with the C++ Standard Libray'
tags = ['c++']
math = true
hideAuthor = true
ShowCodeCopyButtons = true

[[bandwidth]]
size = '1k'
cpu = 244.4
gpu = 3.5

[[bandwidth]]
size = '100k'
cpu = 90.8
gpu = 270.3

[[bandwidth]]
size = '1M'
cpu = 64.8
gpu = 333.0

[[bandwidth]]
size = '10M'
cpu = 27.0
gpu = 405.5

[[bandwidth]]
size = '50M'
cpu = 26.4
gpu = 414.5
+++

DAXPY updates each element of a vector independently. We'll turn a CPU loop into a standard C++ algorithm, run it on an NVIDIA GPU, and compare the effective bandwidth.

{{< daxpy-flow >}}

This walkthrough is based on a [self-paced course from NVIDIA's Deep Learning Institute](https://learn.nvidia.com/courses/course-detail?course_id=course-v1:DLI+S-AC-08+V1).

## DAXPY as a Bandwidth Benchmark

DAXPY stands for **D**ouble-precision **A**X **P**lus **Y**, and it computes the following equation.

$$y_i = a \cdot x_i + y_i \quad \forall i$$

Each iteration reads `x[i]` and `y[i]`, then writes `y[i]`. That's 24 bytes of useful data movement for one multiply and one add. For large vectors, memory throughput tends to dominate. Divide the useful bytes by the elapsed time to get the effective bandwidth.

$$\text{Bandwidth} = \frac{3 \times N \times 8 \text{ bytes}}{t}$$

## Starting with a Sequential Loop

A plain for-loop gives us a single-threaded CPU baseline.

```cpp
void daxpy(double a, std::vector<double> const &x, std::vector<double> &y)
{
    for (std::size_t i = 0; i < x.size(); ++i)
    {
        y[i] += a * x[i];
    }
}
```

## Switching to Standard Algorithms

Standard algorithms let us choose how the work runs at the call site. First, use `std::execution::seq` to keep the algorithm sequential. The binary form of `std::transform` takes one element from each input, and here it writes the result back into `y`.

```cpp
#include <algorithm>
#include <cstddef>
#include <execution>
#include <ranges>
#include <vector>

void initialize(std::vector<double> &x, std::vector<double> &y)
{
    auto indices = std::views::iota(std::size_t{0}, x.size());
    auto *data = x.data();

    std::for_each_n(std::execution::seq, indices.begin(), x.size(),
                    [data](std::size_t i) { data[i] = static_cast<double>(i); });
    std::fill_n(std::execution::seq, y.begin(), y.size(), 2.0);
}

void daxpy(double a, std::vector<double> const &x, std::vector<double> &y)
{
    std::transform(
        std::execution::seq,
        x.begin(), x.end(), y.begin(), y.begin(),
        [a](double xi, double yi) { return yi + a * xi; });
}
```

`std::views::iota` supplies the initialisation indices without allocating an index vector. Each index maps to a separate element of `x`.

## Offloading to the GPU with `par_unseq`

Change the execution policy to `std::execution::par_unseq`. The DAXPY calculation stays the same.

```diff
 std::transform(
-    std::execution::seq,
+    std::execution::par_unseq,
     x.begin(), x.end(), y.begin(), y.begin(),
     [a](double xi, double yi) { return yi + a * xi; });
```

Apply the same policy to `std::for_each_n` and `std::fill_n` to initialise the vectors on the GPU. The policy permits parallel and vectorised execution, so the caller must ensure iterations can run independently. Here each update writes to a different element.

Save the full example below as `daxpy.cpp`, then compile it with NVIDIA's `nvc++` and the **`-stdpar=gpu`** flag. The argument to the executable is the vector length.

```bash
nvc++ -std=c++20 -O3 -stdpar=gpu -o daxpy-gpu daxpy.cpp
./daxpy-gpu 1000000
```

The GPU must be able to access the data used by the lambdas. The initialisation lambda captures the pointer to the vector's heap storage by value. With the default Stdpar GPU memory mode on this system, `nvc++` manages access to those allocations. [NVIDIA Stdpar documentation](https://docs.nvidia.com/hpc-sdk/compilers/hpc-compilers-user-guide/#using-stdpar)

{{< code-details "Show the full GPU example" >}}

```cpp
#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstddef>
#include <execution>
#include <iostream>
#include <ranges>
#include <string_view>
#include <vector>

void initialize(std::vector<double> &x, std::vector<double> &y)
{
    auto indices = std::views::iota(std::size_t{0}, x.size());
    auto *data = x.data();

    std::for_each_n(std::execution::par_unseq, indices.begin(), x.size(),
                    [data](std::size_t i) { data[i] = static_cast<double>(i); });
    std::fill_n(std::execution::par_unseq, y.begin(), y.size(), 2.0);
}

void daxpy(double a, std::vector<double> const &x, std::vector<double> &y)
{
    std::transform(
        std::execution::par_unseq,
        x.begin(), x.end(), y.begin(), y.begin(),
        [a](double xi, double yi) { return yi + a * xi; });
}

int main(int argc, char **argv)
{
    if (argc != 2) {
        std::cerr << "Usage: " << argv[0] << " <vector length>\n";
        return 1;
    }

    std::string_view length = argv[1];
    std::size_t n = 0;
    auto last = length.data() + length.size();
    auto [end, error] = std::from_chars(length.data(), last, n);
    if (error != std::errc{} || end != last || n == 0) {
        std::cerr << "Vector length must be a positive integer.\n";
        return 1;
    }

    std::vector<double> x(n), y(n);
    constexpr double a = 2.0;
    initialize(x, y);

    constexpr int warmup = 5;
    constexpr int iterations = 100;
    for (int i = 0; i < warmup; ++i) {
        daxpy(a, x, y);
    }

    auto start = std::chrono::steady_clock::now();
    for (int i = 0; i < iterations; ++i) {
        daxpy(a, x, y);
    }
    auto elapsed = std::chrono::steady_clock::now() - start;

    for (std::size_t i = 0; i < n; ++i) {
        auto expected = 2.0 + (warmup + iterations) * a * static_cast<double>(i);
        if (y[i] != expected) {
            std::cerr << "DAXPY check failed at index " << i << '\n';
            return 1;
        }
    }

    auto seconds = std::chrono::duration<double>(elapsed).count();
    auto bytes = 3.0 * sizeof(double) * n * iterations;
    std::cout << bytes / seconds / 1e9 << " GB/s\n";
}
```

{{< /code-details >}}

## Measured Bandwidth

I compared the single-threaded CPU loop on a Ryzen 7 5800H with the Stdpar implementation on a GeForce RTX 3070 Laptop GPU. I built both with NVIDIA HPC SDK 26.1 (`nvc++`) at `-O3`. Each value is the median of three runs, with five warm-up passes and 100 timed passes per run. The timer covers the DAXPY calls and excludes vector allocation, initialisation, and result checking.

{{< daxpy-bandwidth scale=450 >}}

The CPU loop led at 1,000 elements, where the two vectors fit in cache and the GPU still pays for a kernel launch. At 50 million elements, the GPU reached about 415 GB/s, roughly 16 times the bandwidth of the single-threaded loop on this machine.

To reproduce the CPU baseline, use the sequential `initialize` and the plain for-loop `daxpy` in the full example. Save it as `daxpy-cpu.cpp` and build it with `nvc++ -std=c++20 -O3 -o daxpy-cpu daxpy-cpu.cpp`.
