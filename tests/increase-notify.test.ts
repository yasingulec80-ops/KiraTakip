import { describe, expect, test } from "bun:test";
import { increaseNotificationRecipients } from "../src/lib/increase-notify";

describe("increaseNotificationRecipients — artış bildirimi alıcıları", () => {
  test("malik ve kiracının e-postası varsa ikisi de alınır (sırayla: malik, kiracı)", () => {
    const recipients = increaseNotificationRecipients(
      { name: "Ahmet Yılmaz", email: "ahmet@ornek.com" },
      { name: "Elif Demir", email: "elif@ornek.com" },
    );
    expect(recipients).toEqual([
      { email: "ahmet@ornek.com", name: "Ahmet Yılmaz", role: "owner" },
      { email: "elif@ornek.com", name: "Elif Demir", role: "tenant" },
    ]);
  });

  test("kiracının e-postası yoksa yalnızca malik alınır", () => {
    const recipients = increaseNotificationRecipients(
      { name: "Ahmet Yılmaz", email: "ahmet@ornek.com" },
      { name: "Elif Demir", email: null },
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({ role: "owner" });
  });

  test("malikin e-postası yoksa yalnızca kiracı alınır", () => {
    const recipients = increaseNotificationRecipients(
      { name: "Ahmet Yılmaz", email: "" },
      { name: "Elif Demir", email: "elif@ornek.com" },
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({ role: "tenant" });
  });

  test("iki tarafın da e-postası yoksa alıcı listesi boştur (bildirim planlanmaz)", () => {
    expect(
      increaseNotificationRecipients(
        { name: "Ahmet Yılmaz", email: undefined },
        { name: "Elif Demir", email: null },
      ),
    ).toEqual([]);
  });

  test("isim eksikse rol tabanlı varsayılan kullanılır", () => {
    const recipients = increaseNotificationRecipients(
      { name: null, email: "malik@ornek.com" },
      { name: undefined, email: "kiraci@ornek.com" },
    );
    expect(recipients[0]?.name).toBe("Malik");
    expect(recipients[1]?.name).toBe("Kiracı");
  });

  test("null kişi kaydı (kayıt silinmiş) güvenle işlenir", () => {
    expect(increaseNotificationRecipients(null, undefined)).toEqual([]);
    expect(
      increaseNotificationRecipients(
        { name: "Şirket Malik", email: "firma@ornek.com" },
        null,
      ),
    ).toEqual([
      { email: "firma@ornek.com", name: "Şirket Malik", role: "owner" },
    ]);
  });
});

describe("increaseNotificationRecipients — hatırlatma ayarları tercihleri", () => {
  const owner = { name: "Ahmet Yılmaz", email: "ahmet@ornek.com" };
  const tenant = { name: "Elif Demir", email: "elif@ornek.com" };

  test("tercih verilmezse varsayılan: ikisi de açık", () => {
    expect(increaseNotificationRecipients(owner, tenant)).toHaveLength(2);
  });

  test("notifyTenant: false → kiracı atlanır, malik kalır", () => {
    expect(
      increaseNotificationRecipients(owner, tenant, { notifyTenant: false }),
    ).toEqual([
      { email: "ahmet@ornek.com", name: "Ahmet Yılmaz", role: "owner" },
    ]);
  });

  test("notifyOwner: false → malik atlanır, kiracı kalır", () => {
    expect(
      increaseNotificationRecipients(owner, tenant, { notifyOwner: false }),
    ).toEqual([
      { email: "elif@ornek.com", name: "Elif Demir", role: "tenant" },
    ]);
  });

  test("ikisi de kapalı → bildirim planlanmaz (boş liste)", () => {
    expect(
      increaseNotificationRecipients(owner, tenant, {
        notifyTenant: false,
        notifyOwner: false,
      }),
    ).toEqual([]);
  });

  test("tercih açık ama e-posta yok → yine atlanır (ikisi birden gerekli)", () => {
    expect(
      increaseNotificationRecipients(
        { name: "Ahmet", email: null },
        tenant,
        { notifyTenant: true, notifyOwner: true },
      ),
    ).toEqual([
      { email: "elif@ornek.com", name: "Elif Demir", role: "tenant" },
    ]);
  });
});
