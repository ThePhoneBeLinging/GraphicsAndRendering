struct Uniforms {
    mvp : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

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
    return vec4f(input.color, 1.0);
}