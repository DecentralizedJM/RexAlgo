import { toast } from "sonner";

/**
 * Write `text` to the clipboard and show a success / error toast.
 *
 * Default success label: `"Copied"`. Pass a more specific label when the UI
 * copies different kinds of values (URL, secret, snippet, ...) so the user
 * knows exactly what just landed on their clipboard.
 */
export async function copyText(
  text: string,
  successLabel = "Copied"
): Promise<boolean> {
  if (!text) {
    toast.error("Nothing to copy");
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successLabel);
    return true;
  } catch {
    toast.error("Copy failed — check clipboard permissions");
    return false;
  }
}
