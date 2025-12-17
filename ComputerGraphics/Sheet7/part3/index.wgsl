struct Uniforms {
    mvp : mat4x4<f32>,
    model : mat4x4<f32>,
    texMatrix: mat4x4<f32>,
    eye: vec3<f32>,
    reflective: u32,
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
    @location(1) worldPos: vec3<f32>,
    @location(2) normal: vec3<f32>,
};

@vertex
fn vs(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.position = uniforms.mvp * vec4f(input.position, 1.0);
    output.texCoord = (uniforms.texMatrix * vec4f(input.position, 1.0)).xyz;
    output.worldPos = (uniforms.model * vec4f(input.position, 1.0)).xyz;
    output.normal = normalize((uniforms.model * vec4f(input.position, 0.0)).xyz);
    return output;
}

@fragment
fn fs(input : VertexOutput) -> @location(0) vec4f {
    let incident = normalize(input.worldPos - uniforms.eye);
    let reflection = reflect(incident, normalize(input.normal));
    let texCoord = select(input.texCoord, reflection, uniforms.reflective == 1u);
    return textureSample(cubeTexture, cubeSampler, normalize(texCoord));
}