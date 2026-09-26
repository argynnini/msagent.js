# ACF / ACA format

English | [日本語](acf-aca-format.ja.md)

Web-delivered Microsoft Agent characters are split into an `.acf` file, holding the character data and the list of animations,
and one `.aca` file per animation (the original fetches an `.aca` with `Get` before playing it).
There is no official documentation, so this was worked out from sample files and by disassembling `AgentDpv.dll` from the Microsoft Agent 2.0 SDK.

- Samples: `Genie.acf` and `robby.acf` (both version 2.1), and six `.aca` files (Genie's Show / Greet, and Merlin's GestureUp / MoveLeft / Congratulate / Announce)
- Merlin's `.aca` files match `Merlin.acs` exactly in frame durations, branches, pixels, and sounds
- Where the original reads them: ACF around `0x67fa8b58`, the ACA header around `0x67fa6b85`, frames at `0x67fa7bac`, and mouth images at `0x67fa7e73`

All numbers are little-endian. **Strings are a DWORD character count + UTF-16LE, and unlike ACS they have no terminating NUL.**
Compression is the same as for ACS images (`src/acs/decompress.ts`).

## ACF

| Type   | Contents                                              |
| ------ | ----------------------------------------------------- |
| DWORD  | `0xABCDABC4` (the original also accepts `0xABCDABC2`) |
| DWORD  | Decompressed size                                     |
| DWORD  | Compressed size                                       |
| BYTE[] | Compressed data                                       |

Decompressed contents:

| Type              | Contents                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DWORD             | Version. `0x00020001` = 2.1. The original accepts `0x1001C` / `0x1001E` / `0x1001F` / `0x20001`                                                                                                       |
| WORD              | Number of animations                                                                                                                                                                                  |
| (repeated)        | Name (string), `.aca` file name (string, relative to the `.acf`), a string (empty in all samples; probably the return animation name), DWORD checksum (version 1.30 and later)                        |
| GUID              | Character GUID                                                                                                                                                                                        |
| WORD + (repeated) | Localized info: WORD language ID, name, description, extra data (same layout as ACS)                                                                                                                  |
| …                 | Width, height, transparent color, style, voice, balloon, palette, tray icon, states. **Same layout as the corresponding part of the ACS character info** (the only difference is strings lacking NUL) |

There is no table of section locations (locators) like the one at the start of an ACS. Versions older than 2.1 have a different layout after the GUID (not read, since there are no samples).

## ACA

| Type  | Contents                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| DWORD | Version (same values as ACF). For an unknown value, the original steps back 4 bytes and reads it as an older format with no version or checksum |
| DWORD | Checksum. If it differs from the value in the ACF list, the original fails with error `0x8004200F`                                              |
| BYTE  | Whether compressed. If 1, followed by a DWORD decompressed size, a DWORD compressed size, and the compressed data                               |

The decompressed contents are sounds → images → animation, in that order.

### Sounds

WORD count, then for each: DWORD size + WAV data.

### Images

WORD count, then for each:

| Type           | Contents                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| DWORD          | Size. **If 0, there is no image and nothing follows**                                                                                        |
| BYTE           | Unknown (always 0 in the samples)                                                                                                            |
| BYTE[]         | Pixels. 8-bit palette indices, bottom row first, each row padded to 4 bytes. **Width and height aren't stored; they are the character size** |
| DWORD + BYTE[] | Region (RGNDATA, uncompressed)                                                                                                               |

In ACS a frame is drawn by compositing several images, whereas in ACA each frame is a single, already-composited image.

### Animation

| Type | Contents                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------- |
| BYTE | transitionType (0: return animation, 1: exit branches, 2: none; only for versions newer than 1.31) |
| WORD | Number of frames (if 0, the original fails with error `0x8004200F`)                                |

Each frame:

| Type              | Contents                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SHORT             | Image index (within this ACA; -1 for no image)                                                                                                               |
| SHORT             | Sound index (-1 for none)                                                                                                                                    |
| WORD              | Duration (×10 ms)                                                                                                                                            |
| SHORT, SHORT      | Probably the image offset (always 0 in the samples)                                                                                                          |
| SHORT             | Exit branch target (only for versions newer than 1.31; -2 for none)                                                                                          |
| BYTE + (repeated) | Branches: WORD target frame, WORD probability                                                                                                                |
| BYTE              | Number of mouth images                                                                                                                                       |
| BYTE              | (Only when there is at least one mouth image and the version is newer than 1.31) Unknown (always 0 in the samples). If nonzero, two DWORD-sized blobs follow |
| (repeated)        | Mouth images (below)                                                                                                                                         |

Each mouth image:

| Type                     | Contents                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| BYTE                     | Mouth shape (0–6)                                                      |
| DWORD                    | Pixel data size. If 0, nothing follows                                 |
| BYTE                     | Whether it replaces the character image                                |
| BYTE                     | Whether a region (RGNDATA) follows (only for versions newer than 1.31) |
| SHORT, SHORT, WORD, WORD | Position, width, and height                                            |
| BYTE[]                   | Pixels (cropped to the width and height)                               |
| DWORD + BYTE[]           | Region (only if present)                                               |

## First byte of ACS images

The first byte of an ACS image is an "image present" flag; if it is 0, the image consists of that single byte.
The original (`0x67fb33e0` in `AgentDp2.dll`) fills the frame with the transparent color, composites the images on top, and skips this image (returning S_FALSE;
if the image's location is outside the file, it instead returns `0x80070570` = ERROR_FILE_CORRUPT). In other words, it isn't a corrupt file but a legitimate "no image".

FinFin (`finfin.acs`) has 18 such images (Merlin, Clippit, and Dolphin have none),
including the last frame of MoveLeftReturn, WriteReturn, Idle2_2, and the mouth shapes of Reading and Stock.
Each has a different checksum, so there were presumably separate source images when the character was made, whose contents were lost on export.
Drawing them as the original does makes the character flicker out briefly after MoveLeftReturn, so msagent.js leaves the previous image in place for frames made only of empty images,
and draws the rest pose if it's the last frame of the animation.
