import math

speedOfLight = 2.9979 * 10**8
plancksConstant = 6.6261 * 10**-34

def part1():
    print("Part 1:")
    efficiency = 0.2
    wattage = 25
    wattagePostEfficiency = wattage * efficiency

    wavelength = 500 * 10**-9
    e = (plancksConstant * speedOfLight) / wavelength
    print(f"The energy of a photon with a wavelength of 500 nm is {e} J")

    photonsPerSecond = wattagePostEfficiency / e
    print(f"The number of photons per second is {photonsPerSecond}")


def part2():
    print("Part 2:")

    voltage = 2.4
    amp = 0.7
    diameter = 1e-2
    time = 5 * 60
    sr = 4 * math.pi

    power = voltage * amp
    intensity = power / sr
    area = sr * (diameter / 2) ** 2
    exitance = power / area
    energy = power * time

    print(f"Radiant flux (Φ): {power:.4f} W")
    print(f"Radiant intensity (I): {intensity:.6f} W/sr")
    print(f"Radiant exitance (M): {exitance:.2f} W/m²")
    print(f"Emitted energy in 5 minutes (E): {energy:.2f} J")
    print(f"Surface area (A): {area:.8f} m²")

def part3():
    print("Part 3:")
    voltage = 2.4
    amp = 0.7
    power = voltage * amp
    opening = 6e-3
    distance = 1
    area = math.pi * (opening / 2) ** 2
    irradiance = power / (4 * math.pi * distance ** 2)
    power_through_opening = irradiance * area
    print(f"Irradiance at {distance} m: {irradiance:.6f} W/m²")
    print(f"Power through opening: {power_through_opening:.6f} W")

def part4():
    print("Part 4:\n")
    power = 200
    efficiency = 0.20
    distance = 2.0
    V_lambda = 0.1
    constant = 685

    Phi = power * efficiency

    I_e = Phi / (4 * math.pi)

    E_radiometric = I_e / (distance ** 2)

    E_photometric = E_radiometric * constant * V_lambda
    print(f"Irradiance at table (E_radiometric): {E_radiometric:.6f} W/m²")
    print(f"Illuminance at table (E_photometric): {E_photometric:.2f} lux")

def part5():
    print("Part 5:")
    knownIntensity = 40
    distanceToKnownSource = 0.35
    distanceToNewSource = 0.65
    newIntensity = knownIntensity * (distanceToKnownSource / distanceToNewSource) ** 2
    print(f"New intensity at 0.65 m: {newIntensity:.2f} lux")

def part6():
    print("Part 6:")
    L = 5000
    width = 0.10
    height = 0.10
    time = 1.0

    M = math.pi * L

    A = width * height

    Phi = M * A

    E = Phi * time

    print(f"Radiance (L): {L:.2f} W/(sr·m²)")
    print(f"Radiant exitance / Radiosity (M): {M:.2f} W/m²")
    print(f"Emitter area (A): {A:.4f} m²")
    print(f"Radiant flux (Φ): {Phi:.4f} W")
    print(f"Emitted energy in 1 s (E): {E:.4f} J")

def part7():
    print("Part 7:")
    L0 = 6000
    width = 0.10
    height = 0.10
    A = width * height

    M = L0 * math.pi
    Phi = M * A

    print(f"Radiant exitance (M): {M:.2f} W/m²")
    print(f"Power of the source (Φ): {Phi:.2f} W")


def part8():
    print("Part 8:")
    Phi_sun = 3.91e26
    A_sun = 6.07e18
    r_earth = 1.50e11
    r_mars = 2.28e11
    
    # Its warmest on the earth due to the distance from the sun. A seen earlier the irradiance
    # is oppositely proportional to the distance from the source.

    R_sun = math.sqrt(A_sun / (4 * math.pi))

    M_sun = Phi_sun / A_sun
    L_sun = M_sun / math.pi

    sin_alpha_earth = R_sun / r_earth
    sin_alpha_mars = R_sun / r_mars

    alpha_earth = math.asin(sin_alpha_earth)
    alpha_mars = math.asin(sin_alpha_mars)

    Omega_earth = 2 * math.pi * (1 - math.cos(alpha_earth))
    Omega_mars = 2 * math.pi * (1 - math.cos(alpha_mars))

    E_earth = L_sun * Omega_earth
    E_mars = L_sun * Omega_mars

    E1s_earth = E_earth * 1
    E1s_mars = E_mars * 1

    print(f"Sun radius: {R_sun:.3e} m")
    print(f"Radiant exitance (M): {M_sun:.3e} W/m²")
    print(f"Radiance (L): {L_sun:.3e} W/(sr·m²)")
    print()
    print(f"Solid angle at Earth (Ω_E): {Omega_earth:.3e} sr")
    print(f"Solid angle at Mars  (Ω_M): {Omega_mars:.3e} sr")
    print()
    print(f"Irradiance at Earth: {E_earth:.3f} W/m²")
    print(f"Irradiance at Mars : {E_mars:.3f} W/m²")
    print()
    print(f"Energy on 1 m² in 1 s (Earth): {E1s_earth:.3f} J")
    print(f"Energy on 1 m² in 1 s (Mars) : {E1s_mars:.3f} J")


def part9():
    print("Part 9:")
    L = 1000
    E_full = L * math.pi
    print(f"Irradiance (full sky): {E_full:.2f} W/m²")

    half_angle_deg = 30
    theta = math.radians(half_angle_deg)
    E_cone = L * math.pi * (math.sin(theta) ** 2)
    print(f"Irradiance (cone, 30°): {E_cone:.2f} W/m²")

part1()
part2()
part3()
part4()
part5()
part6()
part7()
part8()
part9()