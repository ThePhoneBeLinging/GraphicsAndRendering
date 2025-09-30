# Part 3

## Model Matrix
Translation matrix: T(tx, ty, tz)
x Rotation matrix: Rx(θ)
y Rotation matrix: Ry(θ)

## View Matrix
V = LookAt(eye, center, up)

## Projection Matrix
P = Perspective(fov, aspect, near, far)

## Z-Fix Matrix
z = zfix

## Composite Matrix
- Cube 1
- - M1 = T1 * BaseModel
- - MVP1 = P * V * M1
- Cube 2
- - M2 = T2 * BaseModel
- - MVP2 = P * V * M2
- Cube 3
- - M3 = T3 * BaseModel
- - MVP3 = P * V * M3