"""Keep one XTest connection open for pointer, wheel and button events."""

import ctypes as c
import json
import signal
import sys

x11 = c.CDLL("libX11.so.6")
xtest = c.CDLL("libXtst.so.6")
display_type = c.c_void_p
x11.XOpenDisplay.argtypes = [c.c_char_p]
x11.XOpenDisplay.restype = display_type
x11.XCloseDisplay.argtypes = [display_type]
x11.XSync.argtypes = [display_type, c.c_int]
x11.XKeysymToKeycode.argtypes = [display_type, c.c_ulong]
x11.XKeysymToKeycode.restype = c.c_ubyte
xtest.XTestQueryExtension.argtypes = [display_type, *([c.POINTER(c.c_int)] * 4)]
xtest.XTestFakeMotionEvent.argtypes = [
    display_type, c.c_int, c.c_int, c.c_int, c.c_ulong,
]
for function in (xtest.XTestFakeKeyEvent, xtest.XTestFakeButtonEvent):
    function.argtypes = [display_type, c.c_uint, c.c_int, c.c_ulong]

display = x11.XOpenDisplay(None)
if not display:
    sys.exit("No se pudo abrir X11.")

keys = {
    "shift": x11.XKeysymToKeycode(display, 0xFFE1),
    "ctrl": x11.XKeysymToKeycode(display, 0xFFE3),
}
held_keys = set()
held_buttons = set()


def button(code, down, delay=0):
    xtest.XTestFakeButtonEvent(display, code, down, delay)
    (held_buttons.add if down else held_buttons.discard)(code)


def key(modifier, down):
    xtest.XTestFakeKeyEvent(display, keys[modifier], down, 0)
    (held_keys.add if down else held_keys.discard)(modifier)


def terminate(_signal, _frame):
    raise SystemExit


signal.signal(signal.SIGTERM, terminate)
values = [c.c_int() for _ in range(4)]

try:
    if not xtest.XTestQueryExtension(display, *(c.byref(value) for value in values)):
        sys.exit("La sesión X11 no ofrece XTest.")
    print("ready", flush=True)
    for line in sys.stdin:
        for operation, *arguments in json.loads(line):
            if operation == "move":
                xtest.XTestFakeMotionEvent(display, -1, *arguments, 0)
            elif operation == "button":
                button(*arguments)
            elif operation == "key":
                key(*arguments)
            elif operation == "click":
                code, count = arguments
                for index in range(count):
                    button(code, True, 40 if index else 0)
                    button(code, False)
            else:
                raise ValueError(operation)
        x11.XSync(display, 0)
        print("ok", flush=True)
finally:
    for code in tuple(held_buttons):
        button(code, False)
    for modifier in tuple(held_keys):
        key(modifier, False)
    x11.XSync(display, 0)
    x11.XCloseDisplay(display)
