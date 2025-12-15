struct Uniforms {
    aspectRatio: f32,
    cameraConstant: f32,
    repeat: f32,
    filterMode: f32,

    eye: vec3f,
    useTexture: f32,

    up: vec3f,
    scaleFactor: f32,

    at: vec3f,
    jitterVectorCount: f32,

    gamma: f32,
    frame: f32,

    canvas_width: f32,
    canvas_height: f32,

    useBlueBackground: f32,
    _pad: vec3f,
};

struct Aabb {
    min: vec3f,
    max: vec3f,
};

struct Ray {
    origin: vec3f,
    direction: vec3f,
    tmin: f32,
    tmax: f32,
};

struct HitInfo {
    has_hit: bool,
    dist: f32,
    position: vec3f,
    normal: vec3f,
    diffuse: vec3f,
    emission: vec3f,
    shader: i32,
    iof: f32,
    emit: bool,
    throughput: vec3f,
};

struct JitterBuffer {
    data: array<vec2f>,
};

struct VertexAttribs {
    position: vec4f,
    normal: vec4f,
};

struct Material {
    emission: vec4f,
    diffuse: vec4f,
};

@group(0) @binding(0)  var<uniform> uniforms: Uniforms;
@group(0) @binding(1)  var my_texture: texture_2d<f32>;
@group(0) @binding(2)  var<storage, read> jitters: JitterBuffer;
@group(0) @binding(3)  var<storage, read> attribs: array<VertexAttribs>;
@group(0) @binding(4)  var<storage, read> meshFaces: array<vec4u>;
@group(0) @binding(5)  var<storage, read> materials: array<Material>;
@group(0) @binding(6)  var<storage, read> lightIndices: array<u32>;
@group(0) @binding(7)  var<storage, read> treeIds: array<u32>;
@group(0) @binding(8)  var<storage, read> bspTree: array<vec4u>;
@group(0) @binding(9)  var<storage, read> bspPlanes: array<f32>;
@group(0) @binding(10) var<uniform> aabb: Aabb;
@group(0) @binding(11) var renderTexture: texture_2d<f32>;        

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

fn orthonormal_camera_basis() -> mat3x3<f32> {
    let w = normalize(uniforms.eye - uniforms.at);
    let u = normalize(cross(uniforms.up, w));
    let v = cross(w, u);
    return mat3x3<f32>(u, v, w);
}

fn intersect_aabb_clip(r: ptr<function, Ray>) -> bool {
    let p1 = (aabb.min - (*r).origin) / (*r).direction;
    let p2 = (aabb.max - (*r).origin) / (*r).direction;
    let pmin = min(p1, p2);
    let pmax = max(p1, p2);
    var t0 = max(pmin.x, max(pmin.y, pmin.z)) - 1.0e-4;
    var t1 = min(pmax.x, min(pmax.y, pmax.z)) + 1.0e-4;

    if (t0 > t1 || t0 > (*r).tmax || t1 < (*r).tmin) {
        return false;
    }
    (*r).tmin = max(t0, (*r).tmin);
    (*r).tmax = min(t1, (*r).tmax);
    return true;
}

fn intersect_triangle(r: ptr<function, Ray>, hit: ptr<function, HitInfo>, face_index: u32) -> bool {
    let face = meshFaces[face_index];

    let p0 = attribs[face.x].position.xyz;
    let p1 = attribs[face.y].position.xyz;
    let p2 = attribs[face.z].position.xyz;

    let e0 = p1 - p0;
    let e1 = p2 - p0;

    let EPS = 1e-6;
    let pvec = cross((*r).direction, e1);
    let det  = dot(e0, pvec);

    if (abs(det) < EPS) { return false; }
    let invDet = 1.0 / det;

    let tvec = (*r).origin - p0;
    let u = dot(tvec, pvec) * invDet;
    if (u < -EPS || u > 1.0 + EPS) { return false; }

    let qvec = cross(tvec, e0);
    let v = dot((*r).direction, qvec) * invDet;
    if (v < -EPS || u + v > 1.0 + EPS) { return false; }

    let t = dot(e1, qvec) * invDet;
    if (!(t >= (*r).tmin - 1e-6 && t <= (*r).tmax + 1e-6)) { return false; }

    let w0 = 1.0 - u - v;
    let n0 = attribs[face.x].normal.xyz;
    let n1 = attribs[face.y].normal.xyz;
    let n2 = attribs[face.z].normal.xyz;
    let interpN = normalize(n0 * w0 + n1 * u + n2 * v);

    let mid = face.w;
    let mat = materials[mid];

    (*hit).has_hit  = true;
    (*hit).dist     = t;
    (*hit).position = (*r).origin + (*r).direction * t;
    (*hit).normal   = interpN;
    (*hit).diffuse  = mat.diffuse.xyz;
    (*hit).emission = mat.emission.xyz;
    (*hit).shader   = 0;
    (*hit).iof      = 1.0;
    (*hit).emit     = false;
    (*hit).throughput = vec3f(1.0);
    return true;
}

const MAX_LEVEL: u32 = 20u;
const BSP_LEAF: u32 = 3u;

var<private> branch_node: array<vec2u, MAX_LEVEL>;
var<private> branch_ray : array<vec2f, MAX_LEVEL>;

fn intersect_trimesh(r: ptr<function, Ray>, hit: ptr<function, HitInfo>) -> bool {
    var branch_lvl = 0u;
    var node = 0u;

    for (var i = 0u; i <= MAX_LEVEL; i = i + 1u) {
        let tree_node = bspTree[node];
        let axis_or_leaf = tree_node.x & 3u;

        if (axis_or_leaf == BSP_LEAF) {
            let count = tree_node.x >> 2u;
            let offset = tree_node.y;

            var found_any = false;
            for (var j = 0u; j < count; j = j + 1u) {
                let tri_idx = treeIds[offset + j];
                if (intersect_triangle(r, hit, tri_idx)) {
                    (*r).tmax = (*hit).dist;
                    found_any = true;
                }
            }
            if (found_any) { return true; }

            if (branch_lvl == 0u) { return false; }
            branch_lvl = branch_lvl - 1u;
            i = branch_node[branch_lvl].x;
            node = branch_node[branch_lvl].y;
            (*r).tmin = branch_ray[branch_lvl].x;
            (*r).tmax = branch_ray[branch_lvl].y;
            continue;
        }

        let axis = axis_or_leaf;
        let plane = bspPlanes[node];

        let dir_a = (*r).direction[axis];
        let org_a = (*r).origin[axis];
        let left_id = tree_node.z;
        let right_id = tree_node.w;

        var near_node = left_id;
        var far_node = right_id;
        if (dir_a < 0.0) {
            near_node = right_id;
            far_node  = left_id;
        }

        let denom = select(dir_a, 1.0e-8, abs(dir_a) < 1.0e-8);
        let t = (plane - org_a) / denom;

        if (t > (*r).tmax) {
            node = near_node;
        } else if (t < (*r).tmin) {
            node = far_node;
        } else {
            branch_node[branch_lvl].x = i;
            branch_node[branch_lvl].y = far_node;
            branch_ray[branch_lvl].x = t;
            branch_ray[branch_lvl].y = (*r).tmax;
            branch_lvl = branch_lvl + 1u;

            (*r).tmax = t;
            node = near_node;
        }
    }
    return false;
}

fn intersect_scene(r: ptr<function, Ray>, hit: ptr<function, HitInfo>) -> bool {
    // Mirror sphere on the left
    let left_sphere_center = vec3f(420.0, 90.0, 370.0);
    let left_sphere_radius = 90.0;
    if (intersect_sphere(r, hit, left_sphere_center, left_sphere_radius, 1, 1.0)) {
        (*r).tmax = (*hit).dist;
    }

    // Transparent sphere on the right
    let right_sphere_center = vec3f(130.0, 90.0, 250.0);
    let right_sphere_radius = 90.0;
    if (intersect_sphere(r, hit, right_sphere_center, right_sphere_radius, 3, 1.5)) {
        (*r).tmax = (*hit).dist;
    }

    if (intersect_aabb_clip(r)) {
        if (intersect_trimesh(r, hit)) {
            (*r).tmax = (*hit).dist;
        }
    }
    return (*hit).has_hit;
}

fn tea(val0: u32, val1: u32) -> u32 {
    const N: u32 = 16u;
    var v0 = val0;
    var v1 = val1;
    var s0: u32 = 0u;
    for (var n = 0u; n < N; n = n + 1u) {
        s0 += 0x9e3779b9u;
        v0 += ((v1 << 4u) + 0xa341316cu) ^ (v1 + s0) ^ ((v1 >> 5u) + 0xc8013ea4u);
        v1 += ((v0 << 4u) + 0xad90777du) ^ (v0 + s0) ^ ((v0 >> 5u) + 0x7e95761eu);
    }
    return v0;
}

fn mcg31(prev: ptr<function, u32>) -> u32 {
    const A: u32 = 1977654935u;
    *prev = (A * (*prev)) & 0x7fffffffu;
    return *prev;
}

fn rnd(prev: ptr<function, u32>) -> f32 {
    return f32(mcg31(prev)) / f32(0x80000000u);
}

fn sample_cosine_hemisphere(normal: vec3f, seed: ptr<function, u32>) -> vec3f {
    const PI = 3.14159265359;
    let xi1 = rnd(seed);
    let xi2 = rnd(seed);
    let r = sqrt(xi1);
    let theta = 2.0 * PI * xi2;
    let x = r * cos(theta);
    let y = r * sin(theta);
    let z = sqrt(1.0 - xi1);

    let w = normalize(normal);
    let a = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(w.x) > 0.1);
    let u = normalize(cross(a, w));
    let v = cross(w, u);

    return normalize(x * u + y * v + z * w);
}

fn sample_area_lights(r: ptr<function, Ray>, hit: ptr<function, HitInfo>, seed: ptr<function, u32>) -> vec3f {
    const PI = 3.14159265359;

    let nLights = arrayLength(&lightIndices);
    if (nLights == 0u) {
        return vec3f(0.0);
    }

    let surface_diffuse = (*hit).diffuse;
    let surface_normal = normalize((*hit).normal);
    let p = (*hit).position;
    let brdf = surface_diffuse / PI;

    let li = u32(rnd(seed) * f32(nLights));
    let idx = min(li, nLights - 1u);
    let fidx = lightIndices[idx];
    let face = meshFaces[fidx];

    let v0 = attribs[face.x].position.xyz;
    let v1 = attribs[face.y].position.xyz;
    let v2 = attribs[face.z].position.xyz;

    let xi1 = rnd(seed);
    let xi2 = rnd(seed);
    let a = 1.0 - sqrt(xi1);
    let b = (1.0 - xi2) * sqrt(xi1);
    let c = xi2 * sqrt(xi1);
    let xc = a * v0 + b * v1 + c * v2;

    let e1 = v1 - v0;
    let e2 = v2 - v0;
    let nL = normalize(cross(e1, e2));
    let A = 0.5 * length(cross(e1, e2));
    if (A <= 0.0) { return vec3f(0.0); }

    let vecL = xc - p;
    let rlen = length(vecL);
    if (rlen <= 1e-6) { return vec3f(0.0); }
    let wi = vecL / rlen;

    let matId = face.w;
    let Le = materials[matId].emission.xyz;
    if (length(Le) < 1e-6) { return vec3f(0.0); }

    let cosS = max(dot(surface_normal, wi), 0.0);
    if (cosS <= 0.0) { return vec3f(0.0); }

    let cosL = max(dot(-wi, nL), 0.0);
    if (cosL <= 0.0) { return vec3f(0.0); }

    let shadow_tmax = max(rlen - 1e-3, 1e-3);
    var shadowRay = Ray(p + surface_normal * 1e-4, wi, 1e-4, shadow_tmax);
    var shadowHit = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), 0, 1.0, true, vec3f(1.0));
    if (intersect_scene(&shadowRay, &shadowHit)) { return vec3f(0.0); }

    let G = cosL / (rlen * rlen);
    let contrib = brdf * Le * G * cosS * f32(nLights) * A;

    return contrib;
}

fn intersect_sphere(r: ptr<function, Ray>, hit: ptr<function, HitInfo>, center: vec3f, radius: f32, shader_type: i32, iof_val: f32) -> bool {
    let oc = (*r).origin - center;
    let b = dot(oc, (*r).direction);
    let c = dot(oc, oc) - radius * radius;
    let discriminant = b * b - c;

    if (discriminant < 0.0) { return false; }

    let sqrt_disc = sqrt(discriminant);
    let t1 = -b - sqrt_disc;
    let t2 = -b + sqrt_disc;

    var t = t1;
    if (t < (*r).tmin || t > (*r).tmax) {
        t = t2;
        if (t < (*r).tmin || t > (*r).tmax) {
            return false;
        }
    }

    (*hit).dist = t;
    (*hit).position = (*r).origin + (*r).direction * t;
    (*hit).normal = normalize((*hit).position - center);
    (*hit).has_hit = true;
    (*hit).diffuse = vec3f(0.0);
    (*hit).emission = vec3f(0.0);
    (*hit).shader = shader_type;
    (*hit).iof = iof_val;
    (*hit).emit = false;

    return true;
}

fn fresnel_R(cos_theta_i: f32, cos_theta_t: f32, eta: f32) -> f32 {
    let sin_theta_i_sq = max(0.0, 1.0 - cos_theta_i * cos_theta_i);
    let sin_theta_t_sq = eta * eta * sin_theta_i_sq;
    if (sin_theta_t_sq > 1.0) {
        return 1.0;
    }

    let r_perp = (eta * cos_theta_i - cos_theta_t) / (eta * cos_theta_i + cos_theta_t);
    let r_parallel = (cos_theta_i - eta * cos_theta_t) / (cos_theta_i + eta * cos_theta_t);
    return 0.5 * (r_perp * r_perp + r_parallel * r_parallel);
}

fn mirror_shader(r: ptr<function, Ray>, hit: ptr<function, HitInfo>) -> vec3f {
    let reflected = reflect(normalize((*r).direction), normalize((*hit).normal));
    (*hit).has_hit = false;
    let dir = normalize(reflected);
    (*r).direction = dir;
    (*r).origin = (*hit).position + dir * 1.0e-4;
    (*r).tmin = 1.0e-4;
    (*r).tmax = 1e9;
    (*hit).emit = true;
    return vec3f(0.0);
}

fn refract_shader(r: ptr<function, Ray>, hit: ptr<function, HitInfo>) -> vec3f {
    let entering = dot((*r).direction, (*hit).normal) <= 0.0;
    let n = select(-(*hit).normal, (*hit).normal, entering);
    let eta = select((*hit).iof / 1.0, 1.0 / (*hit).iof, entering);
    let refracted = normalize(refract((*r).direction, n, eta));

    (*r).direction = refracted;
    (*r).origin = (*hit).position + refracted * 1e-4;
    (*r).tmin = 0.1;
    (*r).tmax = 1e9;
    (*hit).has_hit = false;
    (*hit).emit = true;
    return vec3f(0.0);
}

fn transparent_shader(r: ptr<function, Ray>, hit: ptr<function, HitInfo>, seed: ptr<function, u32>) -> vec3f {
    let dir = normalize((*r).direction);
    let surf_normal = normalize((*hit).normal);
    let entering = dot(dir, surf_normal) <= 0.0;
    let n = select(-surf_normal, surf_normal, entering);
    let eta = select((*hit).iof, 1.0 / (*hit).iof, entering);

    let cos_theta_i = abs(dot(dir, n));
    let sin_theta_i_sq = max(0.0, 1.0 - cos_theta_i * cos_theta_i);
    let sin_theta_t_sq = eta * eta * sin_theta_i_sq;
    let cos_theta_t = sqrt(max(0.0, 1.0 - sin_theta_t_sq));
    let R = fresnel_R(cos_theta_i, cos_theta_t, eta);
    let tir = sin_theta_t_sq > 1.0;
    let choose_reflection = tir || rnd(seed) < R;

    if (choose_reflection) {
        let reflected = reflect(dir, n);
        let new_dir = normalize(reflected);
        (*r).direction = new_dir;
        (*r).origin = (*hit).position + n * 1.0e-4;
    } else {
        let refracted = refract(dir, n, eta);
        let new_dir = normalize(refracted);
        (*r).direction = new_dir;
        (*r).origin = (*hit).position + new_dir * 1.0e-4;
    }

    (*r).tmin = 1.0e-4;
    (*r).tmax = 1e9;
    (*hit).has_hit = false;
    (*hit).emit = true;
    return vec3f(0.0);
}

struct FragOut {
    @location(0) color: vec4f,
    @location(1) accum: vec4f
};

@fragment
fn fs_main(input: VertexOutput) -> FragOut {
    let ix = u32(input.position.x);
    let iy = u32(input.position.y);
    let launch_idx = iy * u32(uniforms.canvas_width) + ix;
    var seed = tea(launch_idx, u32(uniforms.frame));

    let jx = rnd(&seed) - 0.5;
    let jy = rnd(&seed) - 0.5;
    let p = input.imagePlanePos + vec2f(jx / uniforms.canvas_height,
                                        jy / uniforms.canvas_height);

    let cam = orthonormal_camera_basis();
    let u = cam[0];
    let v = cam[1];
    let w = cam[2];
    let dir = normalize(-uniforms.cameraConstant * w
                        + p.x * uniforms.aspectRatio * u
                        + p.y * v);

    var ray = Ray(uniforms.eye, dir, 1.0e-4, 1.0e5);
    var hit = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), 0, 1.0, true, vec3f(1.0));

    var color = vec3f(0.0);
    var throughput = vec3f(1.0);
    var add_emission = true;

    const max_depth = 10;
    for (var depth = 0; depth < max_depth; depth = depth + 1) {
        if (!intersect_scene(&ray, &hit)) {
            break;
        }

        if (add_emission) {
            color += throughput * hit.emission;
        }

        if (hit.shader == 0) {
            let direct = sample_area_lights(&ray, &hit, &seed);
            color += throughput * direct;

            let n = normalize(hit.normal);
            let new_dir = sample_cosine_hemisphere(n, &seed);

            throughput *= hit.diffuse;

            let p_survive = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.05, 0.99);
            if (rnd(&seed) > p_survive) {
                break;
            }
            throughput /= p_survive;

            ray.origin = hit.position + n * 1e-4;
            ray.direction = new_dir;
            ray.tmin = 1e-4;
            ray.tmax = 1e5;

            hit.emit = false;
        } else if (hit.shader == 1) {
            mirror_shader(&ray, &hit);
        } else if (hit.shader == 2) {
            refract_shader(&ray, &hit);
        } else if (hit.shader == 3) {
            transparent_shader(&ray, &hit, &seed);
        } else {
            break;
        }

        add_emission = hit.emit;
    }

    let prev = textureLoad(renderTexture, vec2u(ix, iy), 0).rgb;
    let accum_color = (prev * uniforms.frame + color) / (uniforms.frame + 1.0);

    var out: FragOut;
    let gamma = max(uniforms.gamma, 1.0);
    out.color = vec4f(pow(accum_color, vec3f(1.0 / gamma)), 1.0);
    out.accum = vec4f(accum_color, 1.0);
    return out;
}
