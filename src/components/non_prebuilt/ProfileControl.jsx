import { useEffect, useId, useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { profileAvatarStorage } from "@/services/profileAvatarStorage.js";

function SignedOutAvatar() {
  return (
    <span className="profile-control__avatar-shell flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#1a73e8]">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    </span>
  );
}

function ProfileAvatar({ email, avatarSrc, size = "compact" }) {
  const initial = profileAvatarStorage.getFallbackInitial(email);
  const baseClassName =
    size === "large"
      ? "h-20 w-20 text-3xl"
      : "h-9 w-9 text-sm";

  if (avatarSrc) {
    return (
      <img
        src={avatarSrc}
        alt=""
        className={`profile-control__avatar profile-control__avatar--${size} ${baseClassName} rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      className={`profile-control__avatar profile-control__avatar--${size} ${baseClassName} flex items-center justify-center rounded-full bg-[#7c4dff] font-semibold text-white`}
    >
      {initial}
    </span>
  );
}

export function ProfileControl({
  user,
  sessionStatus,
  isSubmitting = false,
  onSignIn,
  onSignOut,
  onNavigateProfile,
  onPrimaryAction,
  primaryActionLabel = "My profile",
  primaryActionIcon: PrimaryActionIcon = UserRound
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const menuId = useId();

  const email = user?.email ?? "";
  const isSignedIn = sessionStatus === "signed-in" && Boolean(user);

  useEffect(() => {
    let isActive = true;

    if (!isSignedIn) {
      setAvatarSrc(null);
      setIsOpen(false);
      return () => {
        isActive = false;
      };
    }

    setAvatarSrc(null);
    profileAvatarStorage
      .getAvatar(email)
      .then((storedAvatar) => {
        if (isActive) {
          setAvatarSrc(storedAvatar);
        }
      })
      .catch(() => {
        if (isActive) {
          setAvatarSrc(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [email, isSignedIn]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (!isOpen) {
      return undefined;
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0];

    if (!file || !email) {
      return;
    }

    try {
      setUploadError("");
      const nextAvatar = await profileAvatarStorage.storeAvatar(email, file);
      setAvatarSrc(nextAvatar);
    } catch (error) {
      setUploadError(error.message);
    } finally {
      event.target.value = "";
    }
  }

  function handleProfileClick() {
    if (!isSignedIn) {
      onSignIn?.();
      return;
    }

    setIsOpen((current) => !current);
  }

  async function handleSignOutClick() {
    setIsOpen(false);
    await onSignOut?.();
  }

  function handlePrimaryActionClick() {
    setIsOpen(false);
    (onPrimaryAction ?? onNavigateProfile)?.();
  }

  return (
    <div ref={containerRef} className="profile-control relative z-[60]">
      <button
        type="button"
        className="profile-control__button inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#bfd0e6] bg-white p-[2px] text-[#1a73e8] shadow-[0_2px_8px_rgba(23,50,77,0.1)] transition-[transform,border-color,box-shadow] duration-200 hover:scale-[1.04] hover:border-[#1a73e8] hover:shadow-[0_4px_12px_rgba(26,115,232,0.16)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
        aria-controls={isSignedIn ? menuId : undefined}
        aria-expanded={isSignedIn ? isOpen : undefined}
        aria-haspopup={isSignedIn ? "dialog" : undefined}
        aria-label={isSignedIn ? "Open profile menu" : "Sign in"}
        disabled={isSubmitting}
        onClick={handleProfileClick}
      >
        {isSignedIn ? (
          <ProfileAvatar email={email} avatarSrc={avatarSrc} />
        ) : (
          <SignedOutAvatar />
        )}
      </button>

      {isSignedIn && isOpen ? (
        <aside
          id={menuId}
          role="dialog"
          aria-label="Profile menu"
          className="profile-control__popover absolute right-0 top-[calc(100%+0.5rem)] z-[60] w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-[#d8e0ea] bg-white text-[#24292f] shadow-[0_12px_36px_rgba(31,35,40,0.18)]"
        >
          <div className="flex flex-col items-center px-6 pb-5 pt-6 text-center">
            <button
              type="button"
              className="group relative rounded-full outline-none ring-offset-4 ring-offset-white focus-visible:ring-2 focus-visible:ring-[#1a73e8]"
              aria-label="Change your avatar"
              onClick={() => inputRef.current?.click()}
            >
              <span className="block rounded-full border-2 border-white shadow-[0_0_0_2px_#1a73e8] transition-transform duration-200 group-hover:scale-[1.03]">
                <ProfileAvatar email={email} avatarSrc={avatarSrc} size="large" />
              </span>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-[calc(100%+0.625rem)] z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#24292f] px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                Change your avatar
              </span>
            </button>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />

            <p className="mt-12 max-w-full break-all text-sm text-[#57606a]">
              {email}
            </p>

            {uploadError ? (
              <p
                className="mt-3 rounded-lg bg-[#fff1f1] px-3 py-2 text-xs text-[#b3261e]"
                aria-live="polite"
              >
                {uploadError}
              </p>
            ) : null}
          </div>

          {(onPrimaryAction ?? onNavigateProfile) ? (
            <div className="border-t border-[#d8e0ea] p-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-[#f3f4f6] focus-visible:bg-[#f3f4f6] focus-visible:outline-none"
                onClick={handlePrimaryActionClick}
              >
                <PrimaryActionIcon className="h-4 w-4 text-[#57606a]" />
                {primaryActionLabel}
              </button>
            </div>
          ) : null}

          <div className="border-t border-[#d8e0ea] p-2">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-[#f3f4f6] focus-visible:bg-[#f3f4f6] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              onClick={handleSignOutClick}
            >
              <LogOut className="h-4 w-4 text-[#57606a]" />
              {isSubmitting ? "Signing out" : "Sign out"}
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
