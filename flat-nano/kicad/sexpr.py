"""Minimal S-expression reader/writer + KiCad symbol-library helpers."""
import re, os
SYM_DIR = r"D:\KiCAD\share\kicad\symbols"
BS = chr(92)


class Sym(str):
    """Bare token (as opposed to a quoted string)."""


_tok = re.compile(r'\s*(?:(\()|(\))|"((?:[^"' + BS + BS + r']|' + BS + BS + r'.)*)"|([^\s()"]+))')


def parse(text):
    stack, cur, pos = [], [], 0
    while True:
        m = _tok.match(text, pos)
        if not m:
            break
        pos = m.end()
        if m.group(1):
            stack.append(cur); cur = []
        elif m.group(2):
            done = cur; cur = stack.pop(); cur.append(done)
        elif m.group(3) is not None:
            cur.append(m.group(3))      # kept raw (escapes untouched) so dump() writes it back verbatim
        else:
            cur.append(Sym(m.group(4)))
    return cur[0]


def dump(x, ind=0):
    if isinstance(x, list):
        flat = "(" + " ".join(dump(i) for i in x) + ")"
        if len(flat) < 110 or not any(isinstance(i, list) for i in x):
            return flat
        pad = "\n" + "\t" * (ind + 1)
        out, first = "(", True
        for i in x:
            if isinstance(i, list):
                out += pad + dump(i, ind + 1)
            else:
                out += ("" if first else " ") + dump(i)
            first = False
        return out + "\n" + "\t" * ind + ")"
    if isinstance(x, Sym):
        return str(x)
    if isinstance(x, float):
        return ("%.4f" % x).rstrip("0").rstrip(".")
    if isinstance(x, int):
        return str(x)
    return '"' + str(x) + '"'


def find(node, key):
    return [c for c in node if isinstance(c, list) and c and c[0] == key]


_libs = {}


def load_lib(lib):
    if lib not in _libs:
        local = os.path.join(os.path.dirname(os.path.abspath(__file__)), lib + ".kicad_sym")     # project library wins
        t = parse(open(local if os.path.exists(local) else os.path.join(SYM_DIR, lib + ".kicad_sym"), encoding="utf8").read())
        _libs[lib] = {s[1]: s for s in find(t, "symbol")}
    return _libs[lib]


def get_symbol(lib_id):
    """Return a flattened (extends resolved) symbol node named 'Lib:Name'."""
    lib, name = lib_id.split(":")
    syms = load_lib(lib); s = syms[name]; ext = find(s, "extends")
    if ext:
        parent = syms[ext[0][1]]; out = [Sym("symbol"), lib_id]
        props = {p[1]: p for p in find(s, "property")}
        for c in parent[2:]:
            if isinstance(c, list) and c[0] == "property":
                out.append(props.pop(c[1], c))
            elif isinstance(c, list) and c[0] == "symbol":
                out.append([c[0], c[1].replace(parent[1], name, 1)] + c[2:])
            else:
                out.append(c)
        out += list(props.values())
        return out
    return [Sym("symbol"), lib_id] + s[2:]


def pins(symnode, unit=1):
    res = []
    for sub in find(symnode, "symbol"):
        u = int(sub[1].rsplit("_", 2)[-2])
        if u not in (0, unit):
            continue
        for p in find(sub, "pin"):
            at = find(p, "at")[0]
            res.append(dict(num=find(p, "number")[0][1], name=find(p, "name")[0][1], x=float(at[1]), y=float(at[2]),
                            ang=float(at[3]) if len(at) > 3 else 0.0, type=str(p[1])))
    return res


if __name__ == "__main__":
    import sys
    for lid in sys.argv[1:]:
        try:
            ps = pins(get_symbol(lid))
            print(lid, "->", " ".join(f"{p['num']}:{p['name']}" for p in sorted(ps, key=lambda p: (len(p['num']), p['num']))))
        except Exception as e:
            print(lid, "MISSING", repr(e))
