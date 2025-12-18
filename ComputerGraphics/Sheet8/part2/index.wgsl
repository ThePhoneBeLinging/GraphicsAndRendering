struct Uniforms {
    mvp : mat4x4<f32>,
    visibility: f32,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_2d<f32>;

struct VertexInput {
    @location(0) position : vec3<f32>,
    @location(1) uv : vec2<f32>,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) visibility: f32,
};



@vertex
fn vs(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.position = uniforms.mvp * vec4<f32>(input.position, 1.0);
    output.uv = input.uv;
    output.visibility = uniforms.visibility;
    return output;
}

@fragment
fn fs(input : VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(myTexture, mySampler, input.uv);
    return color * input.visibility;
}