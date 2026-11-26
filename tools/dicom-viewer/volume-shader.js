export const vertexShader = `
  out vec3 backFace;
  out vec3 towardCamera;

  void main() {
    backFace = position;
    // The orthographic camera gives every ray the same direction.
    towardCamera = (inverse(modelViewMatrix) * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const fragmentShader = `
  precision highp sampler3D;

  uniform sampler3D voxels;
  uniform vec3 halfSize;
  uniform float whitePoint;
  uniform float density;
  uniform float stepSize;

  in vec3 backFace;
  in vec3 towardCamera;
  out vec4 colour;

  const vec3 ice = vec3(0.21, 0.65, 0.83);
  const vec3 bright = vec3(0.91, 0.99, 1.0);
  const int maxSteps = 180;

  float sampleVolume(vec3 point) {
    return texture(voxels, point / (2.0 * halfSize) + 0.5).r;
  }

  float displayIntensity(float value) {
    return clamp((value - 0.04) / (whitePoint - 0.04), 0.0, 1.0);
  }

  void main() {
    vec3 view = normalize(towardCamera);
    vec3 safeDirection = mix(vec3(-1.0), vec3(1.0), step(0.0, view))
      * max(abs(view), vec3(0.00001));
    vec3 t1 = (-halfSize - backFace) / safeDirection;
    vec3 t2 = (halfSize - backFace) / safeDirection;
    vec3 far = max(t1, t2);
    float lengthInVolume = min(far.x, min(far.y, far.z));
    if (lengthInVolume <= 0.0) discard;

    int steps = clamp(int(ceil(lengthInVolume / stepSize)), 1, maxSteps);
    float distancePerStep = lengthInVolume / float(steps);
    vec3 front = backFace + view * lengthInVolume;
    vec3 point = front - view * (distancePerStep * 0.5);
    vec4 accumulated = vec4(0.0);
    for (int i = 0; i < maxSteps; i++) {
      if (i >= steps) break;
      float intensity = displayIntensity(sampleVolume(point));
      // Accumulate light front to back with opacity measured per millimetre.
      float signal = pow(smoothstep(0.13, 1.0, intensity), 2.1);
      float opacity = 1.0 - exp(-signal * density * distancePerStep * 0.15);
      vec3 tint = mix(ice, bright, pow(intensity, 2.5));
      float amount = opacity * (1.0 - accumulated.a);
      accumulated.rgb += amount * tint;
      accumulated.a += amount;
      if (accumulated.a > 0.99) break;
      point -= view * distancePerStep;
    }

    colour = vec4(accumulated.rgb / max(accumulated.a, 0.00001), accumulated.a);
  }
`;
