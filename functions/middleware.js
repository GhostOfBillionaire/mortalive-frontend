export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.hostname === "invitation.mortalive.com" && url.pathname === "/") {
    url.pathname = "/invitation.html";

    return context.env.ASSETS.fetch(
      new Request(url, context.request)
    );
  }

  return context.next();
}