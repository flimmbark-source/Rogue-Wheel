import type { ComponentProps } from "react";

type LoadingScreenProps = {
  className?: string;
  fullScreen?: boolean;
  imgProps?: ComponentProps<"img">;
};

export default function LoadingScreen({
  className = "",
  fullScreen = true,
  imgProps,
}: LoadingScreenProps) {
  const { className: imgClassName = "", ...restImgProps } = imgProps ?? {};

  const containerClassName = [
    fullScreen ? "fixed inset-0" : "",
    "flex items-center justify-center bg-black",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const imageClassName = ["max-w-[240px] w-2/3 h-auto", imgClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClassName}>
      <img
        src="/rotogo_snap_logo_2.png"
        alt="Rotogo Snap logo"
        className={imageClassName}
        {...restImgProps}
      />
    </div>
  );
}
