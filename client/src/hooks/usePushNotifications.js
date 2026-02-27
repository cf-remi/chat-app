import { useEffect, useRef } from "react";
import { getVapidKey, subscribePush } from "../api.js";

export function usePushNotifications(user) {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      // Reset so we re-subscribe on next login
      subscribedRef.current = false;
      return;
    }
    if (subscribedRef.current) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    async function setup() {
      try {
        const reg = await navigator.serviceWorker.ready;

        // Check if already subscribed
        let subscription = await reg.pushManager.getSubscription();

        if (!subscription) {
          // Ask for permission
          const permission = await Notification.requestPermission();
          if (permission !== "granted") return;

          // Get VAPID key from server
          const { publicKey } = await getVapidKey();

          // Convert base64url to Uint8Array
          const key = urlBase64ToUint8Array(publicKey);

          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
        }

        // Send subscription to server
        const subJson = subscription.toJSON();
        await subscribePush({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        });

        subscribedRef.current = true;
      } catch (err) {
        console.error("Push subscription failed:", err);
      }
    }

    setup();
  }, [user]);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
