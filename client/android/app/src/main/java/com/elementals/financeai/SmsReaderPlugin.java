package com.elementals.financeai;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

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

    @PluginMethod
    public void getRecentBankSms(PluginCall call) {
        if (getPermissionState("sms") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermsCallback");
            return;
        }

        fetchSms(call);
    }

    @PermissionCallback
    private void smsPermsCallback(PluginCall call) {
        if (getPermissionState("sms") == com.getcapacitor.PermissionState.GRANTED) {
            fetchSms(call);
        } else {
            call.reject("READ_SMS permission was denied by user");
        }
    }

    private void fetchSms(PluginCall call) {
        int days = call.getInt("days", 30);
        long cutoffTime = System.currentTimeMillis() - ((long) days * 24 * 60 * 60 * 1000);

        JSArray results = new JSArray();

        try {
            ContentResolver cr = getContext().getContentResolver();
            Uri uri = Uri.parse("content://sms/inbox");
            String[] projection = new String[] { "_id", "address", "body", "date" };
            String selection = "date >= ?";
            String[] selectionArgs = new String[] { String.valueOf(cutoffTime) };
            String sortOrder = "date DESC";

            Cursor cursor = cr.query(uri, projection, selection, selectionArgs, sortOrder);

            if (cursor != null) {
                int idIdx = cursor.getColumnIndex("_id");
                int addrIdx = cursor.getColumnIndex("address");
                int bodyIdx = cursor.getColumnIndex("body");
                int dateIdx = cursor.getColumnIndex("date");

                int count = 0;
                while (cursor.moveToNext() && count < 60) {
                    String body = cursor.getString(bodyIdx);
                    if (body == null) continue;

                    String lower = body.toLowerCase();
                    // Filter for transactional / banking keywords
                    boolean isTransaction = lower.contains("debited") || 
                                           lower.contains("spent") || 
                                           lower.contains("paid") || 
                                           lower.contains("sent rs") || 
                                           lower.contains("vpa") || 
                                           lower.contains("upi ref") || 
                                           (lower.contains("inr") && lower.contains("a/c")) ||
                                           (lower.contains("rs.") && lower.contains("ac "));

                    if (isTransaction) {
                        JSObject sms = new JSObject();
                        sms.put("id", cursor.getString(idIdx));
                        sms.put("address", cursor.getString(addrIdx));
                        sms.put("body", body);
                        sms.put("date", cursor.getLong(dateIdx));
                        results.put(sms);
                        count++;
                    }
                }
                cursor.close();
            }

            JSObject ret = new JSObject();
            ret.put("messages", results);
            ret.put("count", results.length());
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("Failed to read SMS: " + e.getMessage(), e);
        }
    }
}
