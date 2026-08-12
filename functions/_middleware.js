export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (
    url.hostname === "invitation.mortalive.com" &&
    url.pathname === "/"
  ) {
    const invitationUrl = new URL("/_invitation.html", url);

    return context.env.ASSETS.fetch(
      new Request(invitationUrl, context.request)
    );
  }

  return context.next();
}
