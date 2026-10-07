"""Protocol version negotiated by ``hello``.

Adding chat commands and events bumps the minor number. Shapes already on
the wire are unchanged, so the major number stays.
"""

PROTOCOL_MAJOR = 1
PROTOCOL_MINOR = 1
