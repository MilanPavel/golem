"""Protocol version negotiated by ``hello``.

Adding a command, an event, or an optional field bumps the minor number.
A break in a shape already on the wire bumps the major number. A change in
which connection receives an event is a break too.
"""

PROTOCOL_MAJOR = 2
PROTOCOL_MINOR = 15
