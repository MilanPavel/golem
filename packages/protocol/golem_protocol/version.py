"""Protocol version negotiated by ``hello``.

Adding a command, an event, or an optional field bumps the minor number.
A break in a shape already on the wire bumps the major number.
"""

PROTOCOL_MAJOR = 1
PROTOCOL_MINOR = 4
