struct Uniforms {
    mvp : mat4x4<f32>,
    le : f32,
    la : f32,
    kd : f32,
    ks : f32,
    s : f32,
    eyePos: vec3f,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexInput {
    @location(0) position : vec3<f32>,
};

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) omegaR : vec3<f32>,
    @location(1) omegaO : vec3<f32>,
    @location(2) normal : vec3<f32>,
};



@vertex
fn vs(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    let normal = normalize(input.position);
    let lightDir = normalize(vec3f(0.0, 0.0, -1.0));
    output.position = uniforms.mvp * vec4f(input.position, 1.0);
    output.omegaR = reflect(-lightDir, normal);
    output.omegaO = normalize(uniforms.eyePos - input.position);
    output.normal = normal;
    return output;
}

@fragment
fn fs(input : VertexOutput) -> @location(0) vec4f {
    let sphereColor = vec3f(1.0, 0.0, 0.0);
    let specularColor = vec3f(1.0, 1.0, 1.0);
    let normal = normalize(input.normal);
    let omegaR = normalize(input.omegaR);
    let omegaO = normalize(input.omegaO);


    let lprs = uniforms.ks * uniforms.le * pow(max(dot(omegaR, omegaO),0), uniforms.s);


    let ambient = uniforms.la * uniforms.kd * sphereColor;
    let specular = lprs * specularColor;
    let diffuse = vec3f(uniforms.kd * uniforms.le * max(dot(omegaR, omegaO), 0.0)) * sphereColor;

    let color = ambient + diffuse + specular;

    return vec4f(color, 1.0);
}