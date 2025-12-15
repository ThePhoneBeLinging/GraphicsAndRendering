struct Uniforms {
    mvp : mat4x4<f32>,
    model : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var cubeTexture : texture_2d_array<f32>;
@group(0) @binding(2) var cubeSampler : sampler;

struct VertexInput {
    @location(0) position : vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) worldNormal: vec3<f32>,
};

@vertex
fn vs(input : VertexInput) -> VertexOutput {
    let objectNormal = normalize(input.position);
    let worldNormal = normalize((uniforms.model * vec4f(objectNormal, 0.0)).xyz);

    var output : VertexOutput;
    output.position = uniforms.mvp * vec4f(input.position, 1.0);
    output.worldNormal = worldNormal;
    return output;
}

fn sampleCubeMap(normal: vec3<f32>) -> vec4<f32> {
    let absN = abs(normal);
    var uv: vec2<f32>;
    var faceIndex: i32;

    if (absN.x >= absN.y && absN.x >= absN.z) {
        if (normal.x > 0.0) {
            faceIndex = 0;
            uv = vec2<f32>(-normal.z, normal.y) / absN.x;
        } else {
            faceIndex = 1;
            uv = vec2<f32>(normal.z, normal.y) / absN.x;
        }
    } else if (absN.y >= absN.x && absN.y >= absN.z) {
        if (normal.y > 0.0) {
            faceIndex = 2;
            uv = vec2<f32>(normal.x, -normal.z) / absN.y;
        } else {
            faceIndex = 3;
            uv = vec2<f32>(normal.x, normal.z) / absN.y;
        }
    } else {
        if (normal.z > 0.0) {
            faceIndex = 4;
            uv = vec2<f32>(normal.x, normal.y) / absN.z;
        } else {
            faceIndex = 5;
            uv = vec2<f32>(-normal.x, normal.y) / absN.z;
        }
    }

    uv = uv * 0.5 + 0.5;

    return textureSample(cubeTexture, cubeSampler, uv, faceIndex);
}

@fragment
fn fs(input : VertexOutput) -> @location(0) vec4f {
    return sampleCubeMap(normalize(input.worldNormal));
}