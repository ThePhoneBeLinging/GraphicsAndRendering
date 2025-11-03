struct Uniforms {
    mvp : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

// Bindings for the Earth texture and sampler
@group(0) @binding(1) var earthTex : texture_2d<f32>;
@group(0) @binding(2) var earthSampler : sampler;

struct VertexInput {
    @location(0) position : vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) color: vec3<f32>,
    @location(1) surfaceNormal: vec3<f32>,
};



@vertex
fn vs(input : VertexInput) -> VertexOutput {
    let kd = 1.0;
    let lightDir = normalize(vec3f(0.0, 0.0, -1.0));
    let normal = normalize(input.position);

    let diffuse = vec3f(kd * max(dot(normal, lightDir), 0.0));

    var output : VertexOutput;
    output.position = uniforms.mvp * vec4f(input.position, 1.0);
    output.color = diffuse;
    output.surfaceNormal = normal;
    return output;
}

@fragment
fn fs(input : VertexOutput) -> @location(0) vec4f {
    // Re-normalize the interpolated normal
    let n = normalize(input.surfaceNormal);

    // Convert normal (point on unit sphere) to spherical coordinates
    // Longitude (lambda) = atan2(z, x)
    // Latitude (phi) = asin(y)
    // Map longitude to u in [0,1): u = 0.5 + lambda / (2*pi)
    // Map latitude to v in [0,1]: v = 0.5 - phi / pi
    let lambda = atan2(n.z, n.x);
    let phi = asin(n.y);
    let u = 0.5 + lambda / (2.0 * 3.141592653589793);
    let v = 0.5 - phi / 3.141592653589793;

    // Sample the Earth texture
    let texColor = textureSample(earthTex, earthSampler, vec2f(u, v)).rgb;

    // Lighting: ambient + diffuse using sampled color as kd
    let ambientFactor : f32 = 0.15;
    let lightDir = normalize(vec3f(0.0, 0.0, -1.0));
    let lambert = max(dot(n, lightDir), 0.0);
    let color = texColor * (ambientFactor + lambert);

    return vec4f(color, 1.0);
}