struct Uniforms {
    modelView : mat4x4<f32>,
    projection : mat4x4<f32>
};

struct Params {
    baseColor : vec3<f32>,
    matcapMix : f32,
    tintColor : vec3<f32>,
    _pad : f32
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var matcapTex : texture_2d<f32>;
@group(0) @binding(2) var matcapSampler : sampler;
@group(0) @binding(3) var<uniform> params : Params;

struct VSIn {
    @location(0) position : vec3<f32>,
    @location(1) normal   : vec3<f32>
};

struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) normal_view    : vec3<f32>
};

@vertex
fn vs_main(input : VSIn) -> VSOut {
    var out : VSOut;

    let pos_world_view = uniforms.modelView * vec4<f32>(input.position, 1.0);
    out.position = uniforms.projection * pos_world_view;

    let normalMatrix = mat3x3<f32>(
        uniforms.modelView[0].xyz,
        uniforms.modelView[1].xyz,
        uniforms.modelView[2].xyz
    );
    out.normal_view = normalize(normalMatrix * input.normal);

    return out;
}

struct FSOut {
    @location(0) color : vec4<f32>
};

@fragment
fn fs_main(input : VSOut) -> FSOut {
    var out : FSOut;

    let N = normalize(input.normal_view);

    let lightDir = normalize(vec3<f32>(0.3, 0.8, 0.4));
    let ndotl = max(dot(N, lightDir), 0.0);

    let lighting = 0.25 + 0.75 * ndotl;

    var uv = N.xy * 0.5 + vec2<f32>(0.5, 0.5);
    uv = clamp(uv, vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));

    var matcapColor = textureSample(matcapTex, matcapSampler, uv).rgb;

    matcapColor *= params.tintColor;
    matcapColor *= lighting;

    let base = params.baseColor;
    let finalColor = mix(base, matcapColor, params.matcapMix);

    out.color = vec4<f32>(finalColor, 1.0);
    return out;
}
