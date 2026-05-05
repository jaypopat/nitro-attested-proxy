use std::sync::OnceLock;

use aws_nitro_enclaves_nsm_api::driver::nsm_init;

// nsm_init opens a fresh fd on every call; cache it. Kernel cleans up at exit.
static FD: OnceLock<i32> = OnceLock::new();

pub fn init() {
    FD.get_or_init(|| {
        let fd = nsm_init();
        assert!(fd >= 0, "nsm_init failed (fd={fd})");
        fd
    });
}

pub fn fd() -> i32 {
    *FD.get().expect("nsm::init not called")
}
