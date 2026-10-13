"""Umbilic torus pavilion - parametric mesh export (OBJ + STL + JSON).

Units: meters. Y is up (OBJ), Z is up (STL, for Rhino/CAD).
Change the PARAMS block and run:  python umbilic_torus.py
"""
import json, struct, math
import numpy as np

PARAMS = {
    "R": 12.0,        # ring radius: ring center to section center
    "a": 1.2,         # deltoid coefficient: cusps at 3a, concave faces at a
    "turns": 1/3,     # section rotation per lap (1/3 = umbilic torus)
    "h0": 2.4,        # height of section center above ground
    "theta0_deg": -90,# initial section angle (cusp pointing down at u=0)
    "N": 720,         # segments around the ring
    "M": 144,         # segments around the section (multiple of 3)
}

def build(p):
    R, a, tr, h0, N, M = p["R"], p["a"], p["turns"], p["h0"], p["N"], p["M"]
    th0 = math.radians(p["theta0_deg"])
    u = np.linspace(0, 2*np.pi, N, endpoint=False)[:, None]
    t = np.linspace(0, 2*np.pi, M, endpoint=False)[None, :]
    x = a*(2*np.cos(t) + np.cos(2*t)); y = a*(2*np.sin(t) - np.sin(2*t))
    th = th0 + tr*u
    X = x*np.cos(th) - y*np.sin(th); Y = x*np.sin(th) + y*np.cos(th)
    r = R + X
    V = np.stack([r*np.cos(u), h0 + Y, r*np.sin(u)], -1).reshape(-1, 3)
    shift = int(round(M*tr)) % M   # row N wraps to row 0 shifted by the twist
    F = []
    for k in range(N):
        k2 = (k+1) % N
        off = shift if k2 == 0 else 0
        for s in range(M):
            A = k*M + s; D = k*M + (s+1) % M
            B = k2*M + (s+off) % M; C = k2*M + (s+1+off) % M
            F.append((A, B, D)); F.append((B, C, D))
    F = np.array(F)
    # orient outward: signed volume must be positive
    v0, v1, v2 = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    vol = np.einsum("ij,ij->i", v0, np.cross(v1, v2)).sum()/6
    if vol < 0:
        F = F[:, [0, 2, 1]]; vol = -vol
    area = 0.5*np.linalg.norm(np.cross(v1-v0, v2-v0), axis=1).sum()
    # the single edge: cusp t=0 followed over three laps
    edge = []
    laps = 3 if tr % 1 else 1
    for lap in range(laps):
        for k in range(N):
            uu = 2*np.pi*k/N; tt = lap*tr*2*np.pi
            xx = a*(2*np.cos(tt)+np.cos(2*tt)); yy = a*(2*np.sin(tt)-np.sin(2*tt))
            ang = th0 + tr*uu
            XX = xx*np.cos(ang)-yy*np.sin(ang); YY = xx*np.sin(ang)+yy*np.cos(ang)
            edge.append((( R+XX)*np.cos(uu), h0+YY, (R+XX)*np.sin(uu)))
    edge = np.array(edge)
    elen = np.linalg.norm(np.diff(np.vstack([edge, edge[:1]]), axis=0), axis=1).sum()
    return V, F, edge, vol, area, elen

def write_obj(path, V, F, edge):
    with open(path, "w") as f:
        f.write("# Umbilic torus pavilion, meters, Y up\no pavilion\ns off\n")
        for v in V: f.write(f"v {v[0]:.5f} {v[1]:.5f} {v[2]:.5f}\n")
        for a_, b, c in F + 1: f.write(f"f {a_} {b} {c}\n")
        f.write("o single_edge\n")
        n0 = len(V)
        for v in edge: f.write(f"v {v[0]:.5f} {v[1]:.5f} {v[2]:.5f}\n")
        f.write("l " + " ".join(str(n0+i+1) for i in range(len(edge))) + f" {n0+1}\n")

def write_stl(path, V, F):
    Vz = V[:, [0, 2, 1]] * np.array([1, -1, 1])  # Y-up -> Z-up, keep handedness
    tri = Vz[F]
    n = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    with open(path, "wb") as f:
        f.write(b"Umbilic torus pavilion, meters, Z up".ljust(80, b" "))
        f.write(struct.pack("<I", len(F)))
        for i in range(len(F)):
            f.write(struct.pack("<12fH", *n[i], *tri[i, 0], *tri[i, 1], *tri[i, 2], 0))

if __name__ == "__main__":
    p = PARAMS
    V, F, edge, vol, area, elen = build(p)
    write_obj("umbilic_pavilion.obj", V, F, edge)
    write_stl("umbilic_pavilion.stl", V, F)
    a, R = p["a"], p["R"]
    info = {
        "concept": "umbilic torus pavilion", "units": "m",
        "ring_radius_R": R, "section_a": a, "cusp_radius": 3*a, "face_radius": a,
        "section_curve": "deltoid x=a(2cos t+cos 2t), y=a(2sin t-sin 2t)",
        "twist_turns_per_lap": round(p["turns"], 4), "twist_deg": round(p["turns"]*360, 1),
        "section_center_height": p["h0"], "cusp_burial_depth": round(max(0, 3*a-p["h0"]), 2),
        "outer_diameter": 2*(R+3*a), "courtyard_diameter": 2*(R-3*a),
        "edges": 1 if p["turns"] % 1 else 3, "edge_length": round(float(elen), 1),
        "mesh_volume_m3": round(float(vol), 1), "analytic_volume_m3": round(2*math.pi*a*a*2*math.pi*R, 1),
        "mesh_surface_m2": round(float(area), 1),
        "shell_volume_25cm_m3": round(float(area)*0.25, 1),
        "vertices": int(len(V)), "triangles": int(len(F)),
        "material": {"name": "light polished concrete", "color": "#D8D2C6", "roughness": 0.38},
        "site": "Mediterranean coastal sand dunes, low dune shrubs",
        "sun": {"elevation_deg": 8, "azimuth_deg": 262},
        "camera": {"height": 1.6, "fov_deg": 42, "aspect": "1:1"},
    }
    with open("umbilic_pavilion_params.json", "w") as f: json.dump(info, f, indent=2)
    print(json.dumps(info, indent=2))
