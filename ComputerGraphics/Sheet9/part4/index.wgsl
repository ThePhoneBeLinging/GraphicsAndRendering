struct GroundUniforms {
    mvp : mat4x4<f32>,
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
};

@vertex
fn ground_vs(input : GroundVertexInput) -> GroundVertexOutput {
    var output : GroundVertexOutput;
    output.clipPosition = groundUniforms.mvp * vec4<f32>(input.position, 1.0);
    output.uv = input.uv;
    return output;
}

@fragment
fn ground_fs(input : GroundVertexOutput) -> @location(0) vec4<f32> {
    let depthSample = textureSample(depthTexture, groundSampler, input.uv).r;
    let depthColor = vec3<f32>(depthSample);
    return vec4<f32>(depthColor, 1.0);
}

struct TeapotUniforms {
    mvp : mat4x4<f32>,
    model : mat4x4<f32>,
    lightPosition : vec4<f32>,
    eyePosition : vec4<f32>,
};
@group(1) @binding(0) var<uniform> teapotUniforms : TeapotUniforms;

struct LightUniforms {
    mvp : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> lightUniforms : LightUniforms;

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
    output.clipPosition = teapotUniforms.mvp * vec4<f32>(input.position, 1.0);
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
    let ambient = vec3<f32>(0.1, 0.1, 0.1);
    let color = ambient + baseColor * diffuse + vec3<f32>(0.9) * specular;
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
