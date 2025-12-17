struct Uniforms {
    mvp : mat4x4<f32>,
    model : mat4x4<f32>,
    texMatrix: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var cubeTexture : texture_cube<f32>;
@group(0) @binding(2) var cubeSampler : sampler;

struct VertexInput {
    @location(0) position : vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) texCoord: vec3<f32>,
};

@vertex
fn vs(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.position = uniforms.mvp * vec4f(input.position, 1.0);
    output.texCoord = (uniforms.texMatrix * vec4f(input.position, 1.0)).xyz;
    return output;
}

@fragment
fn fs(input : VertexOutput) -> @location(0) vec4f {
    return textureSample(cubeTexture, cubeSampler, normalize(input.texCoord));
}