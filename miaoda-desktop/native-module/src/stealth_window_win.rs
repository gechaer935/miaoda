//! Windows stealth-window attributes for the overlay BrowserWindow.
//!
//! Electron's `setContentProtection(true)` prevents capture, but conferencing
//! apps may still list a visible top-level HWND in their share picker. This
//! moves the overlay out of the normal AppWindow bucket and into ToolWindow
//! style, which removes it from task switching surfaces and reduces exposure in
//! share-source lists that respect extended window styles.

#![cfg(target_os = "windows")]

use napi::bindgen_prelude::*;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos,
    GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
    WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

fn hwnd_from_handle(handle: Buffer) -> Result<HWND> {
    let bytes = handle.as_ref();
    if bytes.len() != std::mem::size_of::<usize>() {
        return Err(Error::new(
            Status::InvalidArg,
            format!(
                "expected HWND handle of {} bytes, got {}",
                std::mem::size_of::<usize>(),
                bytes.len()
            ),
        ));
    }

    let hwnd_value = usize::from_ne_bytes(
        bytes
            .try_into()
            .map_err(|_| Error::new(Status::InvalidArg, "handle slice to array conversion failed"))?,
    );
    if hwnd_value == 0 {
        return Err(Error::new(Status::InvalidArg, "HWND pointer is null"));
    }

    Ok(HWND(hwnd_value as isize))
}

fn refresh_window_frame(hwnd: HWND) -> Result<()> {
    unsafe {
        SetWindowPos(
            hwnd,
            HWND(0),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        .map_err(|e| Error::new(Status::GenericFailure, format!("SetWindowPos failed: {e}")))?;
    }

    Ok(())
}

#[napi]
pub fn apply_stealth_to_window(handle: Buffer) -> Result<()> {
    let hwnd = hwnd_from_handle(handle)?;
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if current == 0 {
            // A zero extended style is legal, so still continue. If the HWND is
            // invalid, SetWindowLongPtrW/SetWindowPos below will fail and report.
        }

        let next = ((current as u32) & !WS_EX_APPWINDOW.0) | WS_EX_TOOLWINDOW.0;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);

        refresh_window_frame(hwnd)?;

        // Belt-and-braces with the Windows 10 2004+ API. Electron's
        // setContentProtection already uses display affinity, but applying it
        // here keeps the native stealth path self-contained.
        let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    }

    Ok(())
}

#[napi]
pub fn remove_stealth_from_window(handle: Buffer) -> Result<()> {
    let hwnd = hwnd_from_handle(handle)?;
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // Turning capture protection off must not turn an assistant overlay
        // back into an AppWindow. APPWINDOW makes Explorer create a taskbar
        // button, while the product expects all assistant windows to remain
        // tool windows regardless of their capture-visibility setting.
        let next = ((current as u32) & !WS_EX_APPWINDOW.0) | WS_EX_TOOLWINDOW.0;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
        refresh_window_frame(hwnd)?;

        // Capture affinity is independent from taskbar/tool-window styling.
        let _ = SetWindowDisplayAffinity(hwnd, WDA_NONE);
    }

    Ok(())
}
