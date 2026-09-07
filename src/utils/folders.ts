/** Ask for a folder. Returns null if the picker is dismissed. */
export async function pickFolder(
  title = "Choose a folder",
): Promise<string | null> {
  const picked = await new ztoolkit.FilePicker(title, "folder").open();
  return typeof picked === "string" && picked ? picked : null;
}
