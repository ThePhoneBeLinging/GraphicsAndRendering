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

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var my_texture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> jitters: JitterBuffer;
@group(0) @binding(3) var<storage, read> attribs: array<VertexAttribs>;
@group(0) @binding(4) var<storage, read> meshFaces: array<vec4u>;
@group(0) @binding(5) var<storage, read> materials: array<Material>;
@group(0) @binding(6) var<storage, read> lightIndices: array<u32>;
@group(0) @binding(7) var<storage, read> treeIds: array<u32>;
@group(0) @binding(8) var<storage, read> bspTree: array<vec4u>;
@group(0) @binding(9) var<storage, read> bspPlanes: array<f32>;
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
            far_node = left_id;
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
    // Left sphere
    /*let left_sphere_center = vec3f(420.0, 90.0, 370.0);
    let left_sphere_radius = 90.0;
    if (intersect_sphere(r, hit, left_sphere_center, left_sphere_radius, 1, 1.0)) {
        (*r).tmax = (*hit).dist;
    }
    
    // Right sphere
    let right_sphere_center = vec3f(130.0, 90.0, 250.0);
    let right_sphere_radius = 90.0;
    if (intersect_sphere(r, hit, right_sphere_center, right_sphere_radius, 2, 1.5)) {
        (*r).tmax = (*hit).dist;
    }*/
    
    // Intersect with trimesh (Cornell box)
    if (intersect_aabb_clip(r)) {
        if (intersect_trimesh(r, hit)) {
            (*r).tmax = (*hit).dist;
        }
    }
    
    return (*hit).has_hit;
}

fn sample_area_lights(r: ptr<function, Ray>, hit: ptr<function, HitInfo>) -> vec3f {
    const PI = 3.14159265359;
    let nLights = arrayLength(&lightIndices);
    if (nLights == 0u) {
        return vec3f(0.0);
    }

    let surface_diffuse = (*hit).diffuse;
    let surface_normal = normalize((*hit).normal);
    let p = (*hit).position;
    let brdf = surface_diffuse / PI;
    var sum = vec3f(0.0);

    for (var k = 0u; k < nLights; k += 1u) {
        let fidx = lightIndices[k];
        let face = meshFaces[fidx];

        let v0 = attribs[face.x].position.xyz;
        let v1 = attribs[face.y].position.xyz;
        let v2 = attribs[face.z].position.xyz;

        let e1 = v1 - v0;
        let e2 = v2 - v0;
        let nL = normalize(cross(e1, e2));
        let A = 0.5 * length(cross(e1, e2));
        if (A <= 0.0) { continue; }

        let xc = (v0 + v1 + v2) / 3.0;
        let vec = xc - p;
        let r = length(vec);
        if (r <= 1e-6) { continue; }
        let wi = normalize(vec);

        let matId = face.w;
        let Le = materials[matId].emission.xyz;
        if (length(Le) < 1e-6) { continue; }

        let cosS = max(dot(surface_normal, wi), 0.0);
        if (cosS <= 0.0) { continue; }
        
        let cosL = max(dot(-wi, nL), 0.0);
        if (cosL <= 0.0) { continue; }

        let shadow_tmax = max(r - 1.0, 1.0);
        var shadowRay = Ray(p, wi, 1.0, shadow_tmax);
        var shadowHit = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), 0, 1.0);
        if (intersect_scene(&shadowRay, &shadowHit)) { continue; }

        let E = Le * (A * cosL) / (r * r);
        let contrib = brdf * E * cosS;
        sum += contrib;
    }

    return sum;
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
    
    return true;
}

fn shade(r: ptr<function, Ray>, hit: ptr<function, HitInfo>) -> vec3f {
    return (*hit).emission + sample_area_lights(r, hit);
}

fn tea(val0: u32, val1: u32) -> u32 {
    const N = 16u;
    var v0 = val0;
    var v1 = val1;
    var s0 = 0u;
    for (var n = 0u; n < N; n++) {
        s0 += 0x9e3779b9;
        v0 += ((v1 << 4) + 0xa341316c) ^ (v1 + s0) ^ ((v1 >> 5) + 0xc8013ea4);
        v1 += ((v0 << 4) + 0xad90777d) ^ (v0 + s0) ^ ((v0 >> 5) + 0x7e95761e);
    }
    return v0;
}

fn mcg31(prev: ptr<function, u32>) -> u32 {
    const LCG_A = 1977654935u;
    *prev = (LCG_A * (*prev)) & 0x7FFFFFFFu;
    return *prev;
}

fn rnd(prev: ptr<function, u32>) -> f32 {
    return f32(mcg31(prev)) / f32(0x80000000u);
}

fn mirror_shader(r: ptr<function, Ray>, hit: ptr<function, HitInfo>) -> vec3f {
    let reflected = reflect(normalize((*r).direction), normalize((*hit).normal));
    
    (*hit).has_hit = false;
    (*r).direction = normalize(reflected);
    (*r).origin = (*hit).position;
    (*r).tmin = 1.0;
    (*r).tmax = 1e9;

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
    
    return vec3f(0.0);
}

struct FragOut {
    @location(0) color: vec4f,
    @location(1) accum: vec4f
};

@fragment
fn fs_main(input: VertexOutput) -> FragOut {
    let p = input.imagePlanePos;
    let cam = orthonormal_camera_basis();
    let u = cam[0];
    let v = cam[1];
    let w = cam[2];

    let origin = uniforms.eye;
    
    let launch_idx = u32(input.position.x) + u32(input.position.y) * u32(uniforms.canvas_width);
    var seed = tea(launch_idx, u32(uniforms.frame));
    
    let jitter_x = rnd(&seed) / uniforms.canvas_width;
    let jitter_y = rnd(&seed) / uniforms.canvas_height;
    
    let aspect = uniforms.aspectRatio;
    let dir = normalize(-uniforms.cameraConstant * w
                        + (p.x + jitter_x) * aspect * u
                        + (p.y + jitter_y) * v);

    var ray = Ray(origin, dir, 1.0e-4, 1.0e5);
    var hit = HitInfo(false, 0.0, vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), 0, 1.0);
    var color = vec3f(0.1, 0.3, 0.6);
    
    const max_depth = 10;
    for (var depth = 0; depth < max_depth; depth = depth + 1) {
        if (intersect_scene(&ray, &hit)) {
            if (hit.shader == 0) {
                color = shade(&ray, &hit);
                break;
            } else if (hit.shader == 1) {
                color = mirror_shader(&ray, &hit);
            } else if (hit.shader == 2) {
                color = refract_shader(&ray, &hit);
            }
        } else {
            break;
        }
    }
    
    let curr_sum = color;
    let prev_color = textureLoad(renderTexture, vec2u(input.position.xy), 0).rgb;
    let accum_color = (prev_color * uniforms.frame + curr_sum) / (uniforms.frame + 1.0);
    
    let gamma = max(uniforms.gamma, 1.0);
    let mapped = pow(accum_color, vec3f(1.0 / gamma));
    return FragOut(vec4f(mapped, 1.0), vec4f(accum_color, 1.0));
}
