struct Uniforms {
    mvp : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

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
    var output : VertexOutput;
    output.position = uniforms.mvp * vec4f(input.position, 1.0);
    output.color = 0.5 * input.position + vec3f(0.5, 0.5, 0.5);
    output.surfaceNormal = normalize(input.position);
    return output;
}

@fragment
fn fs(input : VertexOutput) -> @location(0) vec4f {

    let kd = 1.0;
    let le = 1.0;
    let pl = 1.0;
    let ie = 1.0;
    return vec4f(input.color * kd, 1.0);
}