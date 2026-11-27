# Mind Field phone message format

This documents the Mind Field application protocol, not an official Interaxon API.
The toolkit accepts decoded values; it does not ship an OSC encoder, UDP listener,
phone app or Muse SDK. The layouts were checked against the retained Swift mapper
and receiver at the revision in `extraction.json`.

## Transport and clocks

The original local receiver routes one phone to one UDP port, 8801 through 8808.
Seat identity is assigned by routing, not embedded in these sensor messages.
UDP can lose, duplicate or reorder messages and provides no authentication here.
Keep any receiver on a trusted network and validate message sizes/types before use.

Sensor order is always **TP9, AF7, AF8, TP10**. Bands are `delta`, `theta`, `alpha`,
`beta`, `gamma`, expressed as log10 absolute power. Preserve missing values as NaN
in memory; do not replace them with zero. A JSON transport needs an explicit
non-finite encoding because JSON does not represent NaN.

`tsSec` is sender epoch seconds; `tsMicros` is the fractional microsecond component.
Use local receipt time for freshness. Never subtract the sender clock from the
receiver clock. Sequence counters are independent per address and seat, begin at
zero on app launch, and wrap from 2,147,483,647 to zero. A headset reconnect does
not itself reset those counters.

## Sensor messages

Here `i` means OSC int32 and `f` means float32. Arrays below list every argument
after the address, in order.

| Address | Arguments |
| --- | --- |
| `/mindfield/v2/band/<band>` | `seq:i, tsSec:i, tsMicros:i, tp9:f, af7:f, af8:f, tp10:f` |
| `/mindfield/v2/is_good` | `seq:i, tsSec:i, tsMicros:i, tp9:i, af7:i, af8:i, tp10:i` (flags 0 or 1) |
| `/mindfield/v2/hsi` | `tsSec:i, tsMicros:i, tp9:i, af7:i, af8:i, tp10:i` (fit codes 1, 2 or 4) |
| `/mindfield/v2/artifact` | `tsSec:i, tsMicros:i, headbandOn:i, blink:i, jawClench:i` (flags 0 or 1) |
| `/mindfield/v2/eeg` | `seq:i, tsSec:i, tsMicros:i, n:i`, then `4 × n` floats |

HSI and artifact messages have no sequence argument. Raw EEG floats are interleaved
by sample in the same four-sensor order. Its timestamp belongs to the first sample.
Sampling rate is not carried in this packet: obtain it from the source configuration;
do not infer it from arrival intervals. Raw EEG is documented for interoperability
but ignored by `createSensorValidity()` and not recorded by this toolkit.

## Heartbeat

Address: `/mindfield/streamer/heartbeat`. Schema v1 has the first ten fields;
schema v2 appends five. `s` means OSC string.

| Index | Field | Type |
| --- | --- | --- |
| 0 | `mindfield.streamer.heartbeat.v1` or `.v2` | s |
| 1 | Heartbeat sequence | i |
| 2 | Boot identifier | s |
| 3 | Scene status | s |
| 4 | Muse state | s |
| 5 | Last frame age, milliseconds | i |
| 6 | Transport state | s |
| 7 | Recovery count | i |
| 8 | App version | s |
| 9 | Recovery phase (`healthy` means link up for validity) | s |
| 10 | Phone clock seconds | i |
| 11 | Phone clock fractional milliseconds | i |
| 12 | Headset model | s |
| 13 | Firmware | s |
| 14 | SDK version | s |

Heartbeat fractional time uses **milliseconds**, unlike the sensor packet's
microseconds. Supply decoded heartbeat values to
`validity.heartbeat(heartbeatRecovery(values), receivedAtMs)`; `ingest()` does not
dispatch heartbeat messages. The helper extracts only indexes 7 and 9 and does not
validate the complete heartbeat schema. Validate that at your transport boundary.
