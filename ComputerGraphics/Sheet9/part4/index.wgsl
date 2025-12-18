struct GroundUniforms {
    cameraMVP : mat4x4<f32>,
    lightMVP : mat4x4<f32>,
    lightPosition : vec4<f32>,
};
@group(0) @binding(0) var<uniform> groundUniforms : GroundUniforms;
@group(0) @binding(1) var groundSampler : sampler;
@group(0) @binding(2) var groundTexture : texture_2d<f32>;
@group(0) @binding(3) var depthTexture : texture_2d<f32>;

struct GroundVertexInput {
    @location(0) position : vec3<f32>,
    @location(1) uv : vec2<f32>,
};

struct GroundVertexOutput {
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) worldPos : vec3<f32>,
};

@vertex
fn ground_vs(input : GroundVertexInput) -> GroundVertexOutput {
    var output : GroundVertexOutput;
    output.clipPosition = groundUniforms.cameraMVP * vec4<f32>(input.position, 1.0);
    output.uv = input.uv;
    output.worldPos = input.position;
    return output;
}

fn computeShadowFactor(lightMVP : mat4x4<f32>, worldPos : vec3<f32>) -> f32 {
    let clip = lightMVP * vec4<f32>(worldPos, 1.0);
    let ndc = clip.xyz / clip.w;
    let uv = ndc.xy * 0.5 + vec2<f32>(0.5);
    let clampedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let inside = all(clampedUV == uv);
    let depth = ndc.z * 0.5 + 0.5;
    let shadowDepth = textureSample(depthTexture, groundSampler, clampedUV).r;
    let bias = 0.002;
    let inShadow = f32(depth - bias > shadowDepth);
    return select(0.0, inShadow, inside);
}

@fragment
fn ground_fs(input : GroundVertexOutput) -> @location(0) vec4<f32> {
    let baseColor = textureSample(groundTexture, groundSampler, input.uv).rgb;
    let lightDir = normalize(groundUniforms.lightPosition.xyz - input.worldPos);
    let normal = vec3<f32>(0.0, 1.0, 0.0);
    let diffuse = max(dot(normal, lightDir), 0.0);
    let shadow = computeShadowFactor(groundUniforms.lightMVP, input.worldPos);
    let ambient = 0.25;
    let lighting = ambient + (1.0 - shadow) * diffuse;
    return vec4<f32>(baseColor * lighting, 1.0);
}

struct TeapotUniforms {
    cameraMVP : mat4x4<f32>,
    model : mat4x4<f32>,
    lightMVP : mat4x4<f32>,
    lightPosition : vec4<f32>,
    eyePosition : vec4<f32>,
};
@group(1) @binding(0) var<uniform> teapotUniforms : TeapotUniforms;

struct LightUniforms {
    mvp : mat4x4<f32>,
};
@group(2) @binding(0) var<uniform> lightUniforms : LightUniforms;

struct TeapotVertexInput {
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
};

struct TeapotVertexOutput {
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) worldPos : vec3<f32>,
    @location(1) normal : vec3<f32>,
};

@vertex
fn teapot_vs(input : TeapotVertexInput) -> TeapotVertexOutput {
    var output : TeapotVertexOutput;
    let world = teapotUniforms.model * vec4<f32>(input.position, 1.0);
    let worldNormal = normalize((teapotUniforms.model * vec4<f32>(input.normal, 0.0)).xyz);
    output.clipPosition = teapotUniforms.cameraMVP * vec4<f32>(input.position, 1.0);
    output.worldPos = world.xyz;
    output.normal = worldNormal;
    return output;
}

@fragment
fn teapot_fs(input : TeapotVertexOutput) -> @location(0) vec4<f32> {
    let lightDir = normalize(teapotUniforms.lightPosition.xyz - input.worldPos);
    let viewDir = normalize(teapotUniforms.eyePosition.xyz - input.worldPos);
    let normal = normalize(input.normal);
    let diffuse = max(dot(normal, lightDir), 0.0);
    let halfVector = normalize(lightDir + viewDir);
    let specular = pow(max(dot(normal, halfVector), 0.0), 32.0);
    let baseColor = vec3<f32>(0.8, 0.6, 0.4);
    let shadow = computeShadowFactor(teapotUniforms.lightMVP, input.worldPos);
    let ambient = 0.2;
    let lighting = ambient + (1.0 - shadow) * diffuse;
    let specularLight = (1.0 - shadow) * specular;
    let color = baseColor * lighting + vec3<f32>(0.9) * specularLight;
    return vec4<f32>(color, 1.0);
}

struct LightVertexInput {
    @location(0) position : vec3<f32>,
};

struct LightVertexOutput {
    @builtin(position) clipPosition : vec4<f32>,
    @location(0) ndcDepth : f32,
};

@vertex
fn light_vs(input : LightVertexInput) -> LightVertexOutput {
    var output : LightVertexOutput;
    let clip = lightUniforms.mvp * vec4<f32>(input.position, 1.0);
    output.clipPosition = clip;
    output.ndcDepth = clip.z / clip.w;
    return output;
}

@fragment
fn light_fs(input : LightVertexOutput) -> @location(0) vec4<f32> {
    let depthValue = input.ndcDepth * 0.5 + 0.5;
    return vec4<f32>(depthValue, depthValue, depthValue, 1.0);
}
