struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) imagePlanePos : vec2<f32>,
};

struct Ray {
    origin: vec3<f32>,
    direction: vec3<f32>,
};

@vertex
fn vs_main(@location(0) pos: vec2<f32>) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(pos, 0.0, 1.0);
    out.imagePlanePos = pos;
    return out;
}

@fragment
fn fs_main(@location(0) imagePlanePos: vec2<f32>) -> @location(0) vec4<f32> {
    let origin = vec3<f32>(0.0, 0.0, 0.0);
    let direction = normalize(vec3<f32>(imagePlanePos.x, imagePlanePos.y, -1.0));
    let ray = Ray(origin, direction);
    let color = 0.5 * direction + vec3<f32>(0.5, 0.5, 0.5);
    return vec4<f32>(color, 1.0);
}