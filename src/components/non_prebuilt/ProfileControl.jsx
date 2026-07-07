import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, LogIn, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { profileAvatarStorage } from "@/services/profileAvatarStorage.js";

function SignedOutAvatar() {
  return (
    <span className="profile-control__avatar-shell flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#1a73e8] shadow-[inset_0_0_0_1px_rgba(26,115,232,0.12)]">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-6 w-6"
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
      ? "h-24 w-24 text-4xl"
      : "h-11 w-11 text-lg";

  if (avatarSrc) {
    return (
      <img
        src={avatarSrc}
        alt=""
        className={`profile-control__avatar profile-control__avatar--${size} ${baseClassName} rounded-full object-cover shadow-[0_10px_20px_rgba(26,115,232,0.2)]`}
      />
    );
  }

  return (
    <span
      className={`profile-control__avatar profile-control__avatar--${size} ${baseClassName} flex items-center justify-center rounded-full bg-[#7c4dff] font-semibold text-white shadow-[0_10px_20px_rgba(124,77,255,0.24)]`}
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
  primaryActionLabel = "My Profile",
  primaryActionIcon: PrimaryActionIcon = UserRound,
  primaryActionVariant = "outline",
  align = "left",
  edgeAligned = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  const email = user?.email ?? "";
  const isSignedIn = sessionStatus === "signed-in" && Boolean(user);

  const drawerWidth = useMemo(() => {
    const emailWidth = Math.max(email.length + 8, 28);
    return `min(88vw, max(320px, ${emailWidth}ch))`;
  }, [email]);

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
    <div
      ref={containerRef}
      className={`profile-control relative z-[60] h-full ${align === "right" ? "ml-auto" : ""}`}
    >
      <button
        type="button"
        className={`profile-control__button inline-flex max-w-full items-center gap-3 overflow-hidden border border-[#d7e6fb] bg-[#e8f0fe] text-left text-[#1a73e8] shadow-[0_10px_22px_rgba(26,115,232,0.12)] transition-[transform,background-color,box-shadow] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:scale-[1.036] hover:bg-[#d9e9ff] hover:shadow-[0_12px_26px_rgba(26,115,232,0.16)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 ${edgeAligned ? "h-full rounded-none rounded-br-[22px] border-l-0 border-t-0 px-5 py-0" : "rounded-[18px] px-3 py-2"}`}
        disabled={isSubmitting}
        onClick={handleProfileClick}
      >
        {isSignedIn ? (
          <ProfileAvatar email={email} avatarSrc={avatarSrc} />
        ) : (
          <SignedOutAvatar />
        )}
        <span className="profile-control__meta flex min-w-0 flex-col items-start">
          <span className="profile-control__eyebrow text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5f84c9]">
            Profile
          </span>
          {isSignedIn ? (
            <span className="profile-control__value max-w-[16rem] truncate text-[14px] font-semibold">
              {email}
            </span>
          ) : (
            <span className="profile-control__value inline-flex items-center gap-2 text-[14px] font-semibold">
              <LogIn className="h-4 w-4" />
              Sign In
            </span>
          )}
        </span>
      </button>

      {isSignedIn && isOpen ? (
        <>
          <div
            className="fixed inset-0 z-[55] bg-transparent"
            aria-hidden="true"
            onClick={() => setIsOpen(false)}
          />
          <aside
            className="fixed left-0 top-0 z-[56] flex h-dvh flex-col items-center gap-4 overflow-y-auto border-r border-[#d7e6fb] bg-white/96 px-6 pb-8 pt-22 shadow-[0_18px_44px_rgba(26,115,232,0.16)] backdrop-blur"
            style={{ width: drawerWidth }}
          >
            <ProfileAvatar email={email} avatarSrc={avatarSrc} size="large" />

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />

            <Button
              type="button"
              className="w-full"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              Upload My Avatar
            </Button>

            <div className="w-full rounded-[16px] border border-[#d7e6fb] bg-[#eef5ff] px-4 py-3 text-center text-[14px] font-medium text-[#1a73e8]">
              {email}
            </div>

            {uploadError ? (
              <div className="w-full rounded-[14px] border border-[#ffd2d2] bg-[#fff1f1] px-4 py-3 text-center text-[13px] text-[#b3261e]">
                {uploadError}
              </div>
            ) : null}

            {(onPrimaryAction ?? onNavigateProfile) ? (
              <Button
                type="button"
                variant={primaryActionVariant}
                className="w-full"
                onClick={handlePrimaryActionClick}
              >
                <PrimaryActionIcon className="h-4 w-4" />
                {primaryActionLabel}
              </Button>
            ) : null}

            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={isSubmitting}
              onClick={handleSignOutClick}
            >
              <LogOut className="h-4 w-4" />
              {isSubmitting ? "Signing Out" : "Sign Out"}
            </Button>
          </aside>
        </>
      ) : null}
    </div>
  );
}
