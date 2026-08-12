export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.hostname === "invitation.mortalive.com") {
    const invitationUrl = new URL("/invitation.html", url);

    return context.env.ASSETS.fetch(
      new Request(invitationUrl, context.request)
    );
  }

  return context.next();
}