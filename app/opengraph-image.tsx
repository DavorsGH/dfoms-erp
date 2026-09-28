import {
  renderSocialPreviewImage,
  socialPreviewAlt,
  socialPreviewContentType,
  socialPreviewSize,
} from "./social-preview-image";

export const runtime = "nodejs";

export const alt = socialPreviewAlt;
export const size = socialPreviewSize;
export const contentType = socialPreviewContentType;

export default renderSocialPreviewImage;
