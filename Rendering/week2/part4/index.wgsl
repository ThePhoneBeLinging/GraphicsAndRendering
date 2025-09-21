struct Uniforms {
    aspectRatio: f32,
    cameraConstant: f32,
    _pad0: f32,
    _pad1: f32,
    eye: vec3f,
    _pad2: f32,
    up: vec3f,
    _pad3: f32,
    at: vec3f,
    _pad4: f32,
    gamma: f32,
    _pad5: vec3f,
};

struct Ray {
    origin: vec3f,
    direction: vec3f,
    tmin: f32,
    tmax: f32,
};

struct Color {
    ambient: vec3f,
    diffuse: vec3f,
    specular: vec3f,
};

struct HitInfo {
    has_hit: bool,
    dist: f32,
    position: vec3f,
    normal: vec3f,
    color: Color,
    shader: u32,
    indexOfRefraction: f32,
    shininess: f32
};

struct Light {
    L_i: vec3f,
    w_i: vec3f,
    dist: f32,
    rayFromPoint: vec3f
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
    let origin = uniforms.eye;
    let direction = normalize(-uniforms.cameraConstant * w
                              + p.x * uniforms.aspectRatio * u
                              + p.y * v);

    var ray = Ray(origin, direction, 0, 1e5);
    const maxDepth = 10;
    const background_alpha = 1.0;
    const background_color =  vec3f(0.1, 0.3, 0.6);
    let color = Color(vec3f(0.0), vec3f(0.0), vec3f(0.0));
    var hitInfo = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), color, 0u, 1.5, 0.0);
    var result = vec3f(0.0);

    for (var i = 0; i < maxDepth; i++) {
        if (intersect_scene(&ray, &hitInfo)) {
            result += shade(&ray, &hitInfo);
        } else {
            result += background_color;
            break;
        }
        if (hitInfo.has_hit)
        {
            break;
        }
    }
    return vec4f(pow(result,vec3f(1.0/uniforms.gamma)), background_alpha);
}

fn intersect_scene(ray: ptr<function, Ray>, hitInfo: ptr<function, HitInfo>) -> bool {
    const plane_point  = vec3f(0.0, 0.0, 0.0);
    const plane_normal = vec3f(0.0, 1.0, 0.0);
    const plane_color  = vec3f(0.1, 0.7, 0.0);
    const plane_shinyness = 0;
    const plane_shader = 0u;
    const plane_index_of_refraction = 1.5;

    const triangle_v0 = vec3f(-0.2, 0.1, 0.9);
    const triangle_v1 = vec3f( 0.2, 0.1, 0.9);
    const triangle_v2 = vec3f(-0.2, 0.1,-0.1);
    const triangle_color = vec3f(0.4, 0.3, 0.2);
    const triangle_shinyness = 1;
    const triangle_shader = 2u;
    const triangle_index_of_refraction = 1.5;

    const sphere_c = vec3f(0.0, 0.5, 0.0);
    const sphere_r = 0.3;
    const sphere_color = vec3f(0, 0, 0);
    const sphere_shinyness = 42;
    const sphere_shader = 4u;
    const sphere_index_of_refraction = 1.5;

    var closest_t = (*ray).tmax;
    var found = false;
    let color = Color(vec3f(0.0), vec3f(0.0), vec3f(0.0));
    var best = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), color, 0u, 0.0, 0.0);

    let ph = ray_plane_intersect(*ray, plane_point, plane_normal, plane_color, plane_shader, plane_shinyness, plane_index_of_refraction);
    if (ph.has_hit && ph.dist < closest_t && ph.dist > (*ray).tmin) {
        best = ph;
        closest_t = ph.dist;
        found = true;
    }

    let sh = ray_sphere_intersection(*ray, sphere_c, sphere_r, sphere_color, sphere_shader, sphere_shinyness, sphere_index_of_refraction);
    if (sh.has_hit && sh.dist < closest_t && sh.dist > (*ray).tmin) {
        best = sh;
        closest_t = sh.dist;
        found = true;
    }

    let th = ray_triangle_intersection(*ray, triangle_v0, triangle_v1, triangle_v2, triangle_color, triangle_shader, triangle_shinyness, triangle_index_of_refraction);
    if (th.has_hit && th.dist < closest_t && th.dist > (*ray).tmin) {
        best = th;
        closest_t = th.dist;
        found = true;
    }

    if (found) {
        *hitInfo = best;
        (*ray).tmax = closest_t;
    }
    return found;
}


fn sample_point_light(p: vec3f) -> Light {
    let PI = 3.14159265359;
    let light_pos = vec3f(0.0, 1.0, 0.0);
    let intensity = vec3f(PI);

    let toL = light_pos - p;
    let d2 = max(dot(toL, toL), 1e-6);
    let d = sqrt(d2);
    let wi = toL / d;

    let Li = intensity * uniforms.gamma / d2;

    let rayFromPoint = light_pos - p;

    return Light(Li, wi, d, rayFromPoint);
}

fn shade(ray: ptr<function, Ray>, hitInfo: ptr<function, HitInfo>) -> vec3f {
    const PI = 3.14159265359;
    let light = sample_point_light((*hitInfo).position);

    var shadowRay = Ray(hitInfo.position + 1e-4 * hitInfo.normal, light.rayFromPoint, 0, 1e5);
    var shadowHitInfo = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), 0,0,0);
    var inShadow = intersect_scene(&shadowRay, &shadowHitInfo);


    switch (hitInfo.shader)
    {
        case 0u: { // Plane
            break;
        }
        case 1u: { // Sphere

            let normalizedNormal = normalize((*hitInfo).normal);
            let normailzedDirection = normalize(ray.direction);
            if (dot(normalizedNormal, normailzedDirection) < 0.0) {
                (*hitInfo).indexOfRefraction = 1.0 / (*hitInfo).indexOfRefraction;
            } else {
                (*hitInfo).indexOfRefraction =  (*hitInfo).indexOfRefraction / 1.0;
                (*hitInfo).normal = -(*hitInfo).normal;
            }

            let refractedRayDirection = refract(ray.direction, (*hitInfo).normal, (*hitInfo).indexOfRefraction);
            *ray = Ray((*hitInfo).position - 1e-4 * (*hitInfo).normal, refractedRayDirection, 0, 1e5);
            (*hitInfo).has_hit = false;
            return vec3f(0.0);
        }
        case 2u: { // Triangle
            break;
        }
        case 3u: { // Mirror
            let reflectedRayDirection = reflect(ray.direction, (*hitInfo).normal);
            (*hitInfo).has_hit = false;
            *ray = Ray((*hitInfo).position + 1e-4 * (*hitInfo).normal, reflectedRayDirection, 0, 1e5);
            return vec3f(0.0);
        }
        case 4u: { // Phong
            let viewDir = normalize(-ray.direction);
            let reflectDir = reflect(-light.w_i, (*hitInfo).normal);
            let spec = pow(max(dot(viewDir, reflectDir), 0.0), (*hitInfo).shininess);
            let specular = (*hitInfo).color.specular * spec * ((*hitInfo).shininess + 2) / (2*PI);
            (*hitInfo).color.diffuse += specular;
            // (*hitInfo).color.diffuse *= light.L_i * ((*ray).direction * (*hitInfo).normal);
            break;
        }
        default: {
            break;
        }
    }
    let n = normalize((*hitInfo).normal);
    let hitColor = (*hitInfo).color;

    var finalColor = hitColor.ambient + hitColor.diffuse;
    if (inShadow) {
        finalColor = hitColor.ambient;
    }
    let ndotl = max(dot(n, light.w_i), 0.0);

    // Lambert: Lo = (albedo/π) * Li * cosθ
    let Lo = (finalColor / PI) * light.L_i * ndotl;

    return Lo;
}

fn ray_plane_intersect(ray: Ray, planePoint: vec3f, planeNormal: vec3f, color: vec3f, shader: u32, shinyness: f32, index_of_refraction: f32) -> HitInfo {
    let denom = dot(planeNormal, ray.direction);
    if (abs(denom) > 1e-4) {
        let t = dot(planeNormal, (planePoint - ray.origin)) / denom;
        if (t >= ray.tmin && t <= ray.tmax) {
            let position = ray.origin + t * ray.direction;
            let normal = normalize(planeNormal);
            let randoColor = Color(color * 0.1, color * 0.9, vec3f(0.0));
            return HitInfo(true, t, position, normal, randoColor, shader, index_of_refraction, shinyness);
        }
    }
    return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
}


fn ray_triangle_intersection(ray: Ray, v0: vec3f, v1: vec3f, v2: vec3f, color: vec3f, shader: u32, shinyness: f32, index_of_refraction: f32) -> HitInfo {
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;
    let h = cross(ray.direction, edge2);
    let a = dot(edge1, h);
    if (abs(a) < 0.0001) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }

    let f = 1.0 / a;
    let s = ray.origin - v0;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }

    let q = cross(s, edge1);
    let v = f * dot(ray.direction, q);
    if (v < 0.0 || u + v > 1.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }

    let t = f * dot(edge2, q);
    if (t > ray.tmin && t < ray.tmax) {
        let position = ray.origin + ray.direction * t;
        let normal = normalize(cross(edge1, edge2));
        let colorAsDiffuse = Color(color * 0.1, color * 0.9, vec3f(0.0));
        return HitInfo(true, t, position, normal, colorAsDiffuse, 2u, 1.5, 0.0);
    }
    return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
}

fn ray_sphere_intersection(ray: Ray, sphereCenter: vec3f, sphereRadius: f32, color: vec3f, shader: u32, shinyness: f32, index_of_refraction: f32) -> HitInfo {
    let oc = ray.origin - sphereCenter;
    let a = dot(ray.direction, ray.direction);
    let b = 2.0 * dot(oc, ray.direction);
    let c = dot(oc, oc) - sphereRadius * sphereRadius;
    let discriminant = b * b - 4.0 * a * c;

    if (discriminant < 0.0) {
        return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
    }
    let sqrtDisc = sqrt(discriminant);
    var t = (-b - sqrtDisc) / (2.0 * a);
    if (t < ray.tmin || t > ray.tmax) {
        t = (-b + sqrtDisc) / (2.0 * a);
        if (t < ray.tmin || t > ray.tmax) {
            return HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), Color(vec3f(0.0), vec3f(0.0), vec3f(0.0)), shader, index_of_refraction, shinyness);
        }
    }
    let position = ray.origin + t * ray.direction;
    let normal = normalize(position - sphereCenter);
    let colorAsDiffuse = Color(color * 0.1, color * 0.9, vec3f(0.1));
    return HitInfo(true, t, position, normal, colorAsDiffuse, shader, index_of_refraction, shinyness);
}
