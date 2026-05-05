using System;
using System.Runtime.InteropServices;

public class KsSmbios {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint GetSystemFirmwareTable(uint provider, uint id, byte[] buf, uint size);
    
    public static void Main() {
        uint sig = 0x52534D42;
        uint sz = GetSystemFirmwareTable(sig, 0, null, 0);
        if (sz == 0) { Console.WriteLine("{\"total\":-1,\"used\":-1}"); return; }
        
        byte[] buf = new byte[sz];
        GetSystemFirmwareTable(sig, 0, buf, sz);
        
        int offset = 8;
        int total = 0;
        int used = 0;
        
        while (offset < buf.Length - 4) {
            byte type = buf[offset];
            byte len = buf[offset + 1];
            if (len < 4 || offset + len > buf.Length) break;
            
            if (type == 17) {
                total++;
                if (len >= 0x0E && offset + 0x0E <= buf.Length) {
                    ushort memSize = BitConverter.ToUInt16(buf, offset + 0x0C);
                    bool populated = false;
                    if (memSize != 0 && memSize != 0xFFFF) populated = true;
                    if (memSize == 0x7FFF && len >= 0x20 && offset + 0x20 <= buf.Length) {
                        uint ext = BitConverter.ToUInt32(buf, offset + 0x1C);
                        if (ext != 0) populated = true;
                    }
                    if (populated) used++;
                }
            }
            
            offset += len;
            while (offset < buf.Length - 1) {
                if (buf[offset] == 0 && buf[offset + 1] == 0) { offset += 2; break; }
                offset++;
            }
        }
        Console.WriteLine("{\"total\":" + total + ",\"used\":" + used + "}");
    }
}
