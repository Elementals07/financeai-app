package com.elementals.financeai;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(
            strings = { Manifest.permission.READ_SMS },
            alias = "sms"
        )
    }
)
public class SmsReaderPlugin extends Plugin {

    private static final int DEFAULT_DAYS = 30;
    private static final int MAX_DAYS = 90;
    private static final int MAX_MESSAGES = 60;

    private static final Set<String> BANK_HINTS = new HashSet<>(Arrays.asList(
        "HDFC", "SBI", "AXIS", "ICICI", "KOTAK", "PAYTM", "IDFC", "YES",
        "PNB", "BOB", "BARODA", "CANARA", "UNION", "INDUS", "IDBI", "FEDERAL",
        "RBL", "AIRTEL", "PHONEPE", "GPAY", "UPI", "BHIM", "JIO", "AMAZON",
        "MUTHOOT", "BANDHAN", "CITI", "HSBC", "DBS"
    ));

    @PluginMethod
    public void getRecentBankSms(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermsCallback");
            return;
        }

        fetchSms(call);
    }

    @PermissionCallback
    private void smsPermsCallback(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            fetchSms(call);
        } else {
            call.reject("READ_SMS permission was denied by the user");
        }
    }

    private void fetchSms(PluginCall call) {
        Integer requestedDaysObj = call.getInt("days", DEFAULT_DAYS);
        int requestedDays = requestedDaysObj != null ? requestedDaysObj : DEFAULT_DAYS;
        int days = Math.max(1, Math.min(requestedDays, MAX_DAYS));
        long cutoffTime = System.currentTimeMillis() - ((long) days * 24L * 60L * 60L * 1000L);

        JSArray results = new JSArray();

        try {
            ContentResolver contentResolver = getContext().getContentResolver();
            Uri uri = Uri.parse("content://sms/inbox");
            String[] projection = new String[] { "_id", "address", "body", "date" };
            String selection = "date >= ?";
            String[] selectionArgs = new String[] { String.valueOf(cutoffTime) };
            String sortOrder = "date DESC";

            try (Cursor cursor = contentResolver.query(uri, projection, selection, selectionArgs, sortOrder)) {
                if (cursor == null) {
                    call.reject("SMS inbox is not available on this device");
                    return;
                }

                int idIndex = cursor.getColumnIndex("_id");
                int addressIndex = cursor.getColumnIndex("address");
                int bodyIndex = cursor.getColumnIndex("body");
                int dateIndex = cursor.getColumnIndex("date");

                if (idIndex < 0 || bodyIndex < 0 || dateIndex < 0) {
                    call.reject("SMS inbox does not expose the expected columns");
                    return;
                }

                int count = 0;
                while (cursor.moveToNext() && count < MAX_MESSAGES) {
                    String body = cursor.getString(bodyIndex);
                    if (body == null || body.trim().isEmpty()) {
                        continue;
                    }

                    String address = addressIndex >= 0 ? cursor.getString(addressIndex) : null;
                    if (!isRelevantDebitMessage(address, body)) {
                        continue;
                    }

                    JSObject sms = new JSObject();
                    sms.put("id", cursor.getString(idIndex));
                    sms.put("address", maskSender(address));
                    sms.put("body", body);
                    sms.put("date", cursor.getLong(dateIndex));
                    results.put(sms);
                    count++;
                }
            }

            JSObject ret = new JSObject();
            ret.put("messages", results);
            ret.put("count", results.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read SMS: " + e.getMessage(), e);
        }
    }

    private boolean isRelevantDebitMessage(String address, String body) {
        String lower = body.toLowerCase(Locale.ROOT);

        if (isExcluded(lower)) {
            return false;
        }

        boolean looksLikeBankMessage = isKnownBankSender(address) || hasBankContext(lower);
        if (!looksLikeBankMessage) {
            return false;
        }

        return hasDebitIndicator(lower) && hasAmountIndicator(lower);
    }

    private boolean isKnownBankSender(String address) {
        if (address == null) {
            return false;
        }
        String normalized = address.toUpperCase(Locale.ROOT).replaceFirst("^[A-Z]{2}-", "");
        for (String hint : BANK_HINTS) {
            if (normalized.contains(hint)) {
                return true;
            }
        }
        return false;
    }

    private boolean hasBankContext(String lower) {
        return lower.contains("a/c")
            || lower.contains(" ac ")
            || lower.contains("account")
            || lower.contains("upi")
            || lower.contains("vpa")
            || lower.contains("bank")
            || lower.contains("card")
            || lower.contains("txn")
            || lower.contains("ref");
    }

    private boolean hasDebitIndicator(String lower) {
        return lower.contains("debited")
            || lower.contains("debit")
            || lower.contains("spent")
            || lower.contains("paid")
            || lower.contains("withdrawn")
            || lower.contains("transferred")
            || lower.contains("purchase")
            || lower.contains("sent rs")
            || lower.contains("sent inr")
            || lower.contains("sent ₹");
    }

    private boolean hasAmountIndicator(String lower) {
        return lower.contains("rs")
            || lower.contains("inr")
            || lower.contains("₹");
    }

    private boolean isExcluded(String lower) {
        // OTPs, login alerts and credentials
        if (lower.contains("otp")
            || lower.contains("one time password")
            || lower.contains("verification code")
            || lower.contains("authentication code")
            || lower.contains("do not share")) {
            return true;
        }

        // Credits, refunds, reversals and cashback credits
        if (lower.contains("credited")
            || lower.contains("credit of")
            || lower.contains("refund")
            || lower.contains("reversal")
            || lower.contains("cashback")) {
            return true;
        }

        // Failed or cancelled transactions
        if (lower.contains("failed")
            || lower.contains("declined")
            || lower.contains("unsuccessful")
            || lower.contains("not successful")
            || lower.contains("cancelled")
            || lower.contains("reversed")) {
            return true;
        }

        // Payment requests and collect requests
        if (lower.contains("payment request")
            || lower.contains("collect request")
            || lower.contains("please pay")
            || lower.contains("request money")) {
            return true;
        }

        // Promotional messages
        if (lower.contains("unsubscribe")
            || lower.contains("click here")
            || lower.contains("apply now")
            || lower.contains("limited time")
            || lower.contains("loan offer")) {
            return true;
        }

        return false;
    }

    private String maskSender(String address) {
        if (address == null || address.trim().isEmpty()) {
            return "Bank";
        }
        String normalized = address.toUpperCase(Locale.ROOT).trim();
        int dash = normalized.indexOf('-');
        String code = dash >= 0 && dash + 1 < normalized.length()
            ? normalized.substring(dash + 1)
            : normalized;
        return code.length() > 12 ? code.substring(0, 12) : code;
    }
}
