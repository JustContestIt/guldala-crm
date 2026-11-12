-- «Своя машина» meant the same as pickup; the second way is delivery by Yandex, priced apart (review 12.11.2026, С3).
-- Renaming the value moves every order that had it.
ALTER TYPE "public"."pickup_method" RENAME VALUE 'client_truck' TO 'delivery';
