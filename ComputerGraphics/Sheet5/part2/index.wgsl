struct Uniforms {
    mvp : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexInput {
    @location(0) position : vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
};



@vertex
fn vs(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.position = uniforms.mvp * vec4f(input.position, 1.0);
    return output;
}

@fragment
fn fs(input : VertexOutput) -> @location(0) vec4f {
    return vec4f(0, 0, 0, 1);
}