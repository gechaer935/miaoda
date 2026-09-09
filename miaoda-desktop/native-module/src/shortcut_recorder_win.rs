use napi_derive::napi;
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

#[napi(object)]
pub struct ShortcutKeyInput {
    pub key: String,
    pub ctrl_key: bool,
    pub alt_key: bool,
    pub shift_key: bool,
    pub meta_key: bool,
}

fn is_pressed(vk: i32) -> bool {
    // The high bit is set while the physical key is down. Unlike Chromium's
    // key events this remains observable when RegisterHotKey or Windows itself
    // consumes the shortcut before it reaches the settings BrowserWindow.
    unsafe { GetAsyncKeyState(vk) < 0 }
}

fn virtual_key_name(vk: i32) -> Option<String> {
    match vk {
        0x08 => Some("Backspace".into()),
        0x09 => Some("Tab".into()),
        0x0D => Some("Enter".into()),
        0x1B => Some("Escape".into()),
        0x20 => Some("Space".into()),
        0x21 => Some("PageUp".into()),
        0x22 => Some("PageDown".into()),
        0x23 => Some("End".into()),
        0x24 => Some("Home".into()),
        0x25 => Some("ArrowLeft".into()),
        0x26 => Some("ArrowUp".into()),
        0x27 => Some("ArrowRight".into()),
        0x28 => Some("ArrowDown".into()),
        0x2C => Some("PrintScreen".into()),
        0x2D => Some("Insert".into()),
        0x2E => Some("Delete".into()),
        0x30..=0x39 | 0x41..=0x5A => char::from_u32(vk as u32).map(|c| c.to_string()),
        0x60..=0x69 => Some(format!("num{}", vk - 0x60)),
        0x6A => Some("numMult".into()),
        0x6B => Some("numAdd".into()),
        0x6D => Some("numSub".into()),
        0x6E => Some("numDec".into()),
        0x6F => Some("numDiv".into()),
        0x70..=0x87 => Some(format!("F{}", vk - 0x6F)),
        0xBA => Some(";".into()),
        0xBB => Some("Plus".into()),
        0xBC => Some(",".into()),
        0xBD => Some("-".into()),
        0xBE => Some(".".into()),
        0xBF => Some("/".into()),
        0xC0 => Some("`".into()),
        0xDB => Some("[".into()),
        0xDC => Some("\\".into()),
        0xDD => Some("]".into()),
        0xDE => Some("'".into()),
        _ => None,
    }
}

#[napi]
pub fn get_pressed_shortcut_key() -> Option<ShortcutKeyInput> {
    let ctrl_key = is_pressed(0x11) || is_pressed(0xA2) || is_pressed(0xA3);
    let alt_key = is_pressed(0x12) || is_pressed(0xA4) || is_pressed(0xA5);
    let shift_key = is_pressed(0x10) || is_pressed(0xA0) || is_pressed(0xA1);
    let meta_key = is_pressed(0x5B) || is_pressed(0x5C);
    if !(ctrl_key || alt_key || shift_key || meta_key) {
        return None;
    }

    // Ignore mouse buttons and modifier virtual keys; return the first
    // supported non-modifier key that is physically held.
    const MODIFIERS: [i32; 11] = [
        0x10, 0x11, 0x12, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5,
    ];
    for vk in 0x08..=0xDE {
        if MODIFIERS.contains(&vk) || !is_pressed(vk) {
            continue;
        }
        if let Some(key) = virtual_key_name(vk) {
            return Some(ShortcutKeyInput {
                key,
                ctrl_key,
                alt_key,
                shift_key,
                meta_key,
            });
        }
    }
    None
}
