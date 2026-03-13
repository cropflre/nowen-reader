// Shim for next/image — uses plain <img> tag
import React from "react";

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
}

const Image = React.forwardRef<HTMLImageElement, ImageProps>(
  (
    {
      src,
      alt,
      fill,
      width,
      height,
      sizes,
      priority,
      quality,
      unoptimized,
      placeholder,
      blurDataURL,
      style,
      className,
      ...props
    },
    ref
  ) => {
    const imgStyle: React.CSSProperties = { ...style };

    if (fill) {
      imgStyle.position = "absolute";
      imgStyle.top = 0;
      imgStyle.left = 0;
      imgStyle.width = "100%";
      imgStyle.height = "100%";
    }

    return (
      <img
        ref={ref}
        src={src}
        alt={alt}
        width={fill ? undefined : width}
        height={fill ? undefined : height}
        style={imgStyle}
        className={className}
        loading={priority ? "eager" : "lazy"}
        {...props}
      />
    );
  }
);

Image.displayName = "Image";

export default Image;
