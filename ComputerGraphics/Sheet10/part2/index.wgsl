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
@group(0) @binding(3) var normalTexture : texture_2d<f32>;
@group(0) @binding(4) var normalSampler : sampler;

struct VertexInput {
    @location(0) position : vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) texCoord: vec3<f32>,
    @location(1) worldPos: vec3<f32>,
    @location(2) normal: vec3<f32>,
    @location(3) uv: vec2<f32>,
};

fn rotate_to_normal(n: vec3f, v: vec3f) -> vec3f
{
    let sgn_nz = sign(n.z + 1.0e-16);
    let a = -1.0/(1.0 + abs(n.z));
    let b = n.x*n.y*a;
    return vec3f(1.0 + n.x*n.x*a, b, -sgn_nz*n.x)*v.x
    + vec3f(sgn_nz*b, sgn_nz*(1.0 + n.y*n.y*a), -n.y)*v.y
    + n*v.z;
}

@vertex
fn vs(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.position = uniforms.mvp * vec4f(input.position, 1.0);
    output.texCoord = (uniforms.texMatrix * vec4f(input.position, 1.0)).xyz;
    output.worldPos = (uniforms.model * vec4f(input.position, 1.0)).xyz;
    output.normal = normalize((uniforms.model * vec4f(input.position, 0.0)).xyz);
    output.uv = vec2(atan2(output.normal.x, output.normal.z) / (2.0 * 3.14159265359) + 0.5, asin(output.normal.y) / 3.14159265359 + 0.5);
    return output;
}

@fragment
fn fs(input : VertexOutput) -> @location(0) vec4f {
    let incident = normalize(input.worldPos - uniforms.eye);

    let normal_from_map = textureSample(normalTexture, normalSampler, input.uv).xyz * 2.0 - 1.0;
    let perturbed_normal = rotate_to_normal(normalize(input.normal), normal_from_map);

    let final_normal = select(normalize(input.normal), perturbed_normal, uniforms.reflective == 1u);

    let reflection = reflect(incident, final_normal);
    let texCoord = select(input.texCoord, reflection, uniforms.reflective == 1u);
    return textureSample(cubeTexture, cubeSampler, normalize(texCoord));
}