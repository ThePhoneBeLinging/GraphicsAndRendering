struct Uniforms {
    aspectRatio: f32,
    cameraConstant: f32,
    eye: vec3<f32>,
    up: vec3<f32>,
    at: vec3<f32>,
};

struct Ray {
    origin: vec3<f32>,
    direction: vec3<f32>,
    tmin: f32,
    tmax: f32,
};

struct HitInfo {
    has_hit: bool,
    dist: f32,
    position: vec3f,
    normal: vec3f,
    color: vec3f,
    shader: u32,
};


@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) imagePlanePos : vec2<f32>,
};


@vertex
fn vs_main(@location(0) pos: vec2<f32>) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(pos, 0.0, 1.0);
    out.imagePlanePos = pos;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let p = input.imagePlanePos; // in [-1,1]

    // Camera basis (right-handed)
    let w = normalize(uniforms.eye - uniforms.at);     // camera backward
    let u = normalize(cross(uniforms.up, w));          // camera right
    let v = cross(w, u);                               // camera up

    // Ray through the image plane located at distance 'cameraConstant'
    let origin    = uniforms.eye;
    let direction = normalize(-uniforms.cameraConstant * w
                              + p.x * uniforms.aspectRatio * u
                              + p.y * v);

    var ray = Ray(origin, direction, 1e-4, 1e5);

    var color =  vec3f(0.1, 0.3, 0.6);

    let plane_position = vec3<f32>(0.0, 0.0, 0.0);
    let plane_normal = vec3<f32>(0.0, 1.0, 0.0);
    let plane_color = vec3<f32>(0.1, 0.7, 0.0);

    let triangle_v0 = vec3<f32>(-0.2,0.1,0.9);
    let triangle_v1 = vec3<f32>(0.2,0.1,0.9);
    let triangle_v2 = vec3<f32>(-0.2,0.1,-0.1);
    let triangle_color = vec3<f32>(0.4,0.3,0.2);

    let sphere_c = vec3<f32>(0.0, 0.5, 0.0);
    let sphere_r = 0.3;
    let sphere_color = vec3<f32>(0.0, 0.0, 0.0);

    let point_light_position = vec3<f32>(0.0, 1.0, 0.0);

    let plane_point  = vec3f(0.0, 0.0, 0.0);


    var hit = ray_plane_intersect(ray, plane_point, plane_normal, plane_color);

    if (hit.has_hit) {
        color   = hit.color;
        ray.tmax = hit.dist;
    }

    hit = ray_sphere_intersection(ray, sphere_c, sphere_r, sphere_color);
    if (hit.has_hit) {
      color   = hit.color;
      ray.tmax = hit.dist;
    }

    hit = ray_triangle_intersection(ray, triangle_v0, triangle_v1, triangle_v2, triangle_color);
    if (hit.has_hit) {
       color = hit.color;
       ray.tmax = hit.dist;
    }

    return vec4<f32>(color, 1.0);
}

fn ray_plane_intersect(ray: Ray, planePoint: vec3f, planeNormal: vec3f, color: vec3<f32>) -> HitInfo {
    let denom = dot(planeNormal, ray.direction);
    if (abs(denom) > 1e-4) {
        let t = dot(planeNormal, (planePoint - ray.origin)) / denom;
        if (t >= ray.tmin && t <= ray.tmax) {
            let position = ray.origin + t * ray.direction;
            let normal = normalize(planeNormal);
            return HitInfo(true, t, position, normal, color, 1u);
        }
    }
    return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
}


fn ray_triangle_intersection(ray: Ray, v0: vec3<f32>, v1: vec3<f32>, v2: vec3<f32>, color: vec3<f32>) -> HitInfo {
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;
    let h = cross(ray.direction, edge2);
    let a = dot(edge1, h);
    if (abs(a) < 0.0001) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
    }

    let f = 1.0 / a;
    let s = ray.origin - v0;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
    }

    let q = cross(s, edge1);
    let v = f * dot(ray.direction, q);
    if (v < 0.0 || u + v > 1.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
    }

    let t = f * dot(edge2, q);
    if (t > ray.tmin && t < ray.tmax) {
        let position = ray.origin + ray.direction * t;
        let normal = normalize(cross(edge1, edge2));
        return HitInfo(true, t, position, normal, color, 2u);
    }
    return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
}

fn ray_sphere_intersection(ray: Ray, sphereCenter: vec3<f32>, sphereRadius: f32, color: vec3<f32>) -> HitInfo {
    let oc = ray.origin - sphereCenter;
    let a = dot(ray.direction, ray.direction);
    let b = 2.0 * dot(oc, ray.direction);
    let c = dot(oc, oc) - sphereRadius * sphereRadius;
    let discriminant = b * b - 4.0 * a * c;

    if (discriminant < 0.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
    }
    let sqrtDisc = sqrt(discriminant);
    var t = (-b - sqrtDisc) / (2.0 * a);
    if (t < ray.tmin || t > ray.tmax) {
        t = (-b + sqrtDisc) / (2.0 * a);
        if (t < ray.tmin || t > ray.tmax) {
            return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
        }
    }
    let position = ray.origin + t * ray.direction;
    let normal = normalize(position - sphereCenter);
    return HitInfo(true, t, position, normal, color, 3u);
}
