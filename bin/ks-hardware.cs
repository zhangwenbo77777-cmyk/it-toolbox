using System;
using System.Runtime.InteropServices;

public class KsHardware
{
    // === GetSystemFirmwareTable (SMBIOS) ===
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint GetSystemFirmwareTable(uint provider, uint id, byte[] buf, uint size);

    // === NtPowerInformation (CPU frequency) ===
    [DllImport("ntdll.dll")]
    public static extern int NtPowerInformation(uint level, IntPtr input, int inputSize, IntPtr output, int outputSize);

    const uint ProcessorInformation = 11;

    public static void Main(string[] args)
    {
        string mode = args.Length > 0 ? args[0] : "--smbios";

        if (mode == "--realtime")
        {
            QueryRealtime();
        }
        else if (mode == "--smbios")
        {
            QuerySmbios();
        }
        else if (mode == "--disk")
        {
            // TODO: v1.1.0 后续实现
            Console.WriteLine("{\"error\":\"not implemented\"}");
        }
        else
        {
            Console.WriteLine("{\"error\":\"unknown mode\"}");
        }
    }

    static void QueryRealtime()
    {
        try
        {
            int numCpus = Environment.ProcessorCount;
            int structSize = 24; // PROCESSOR_POWER_INFORMATION: 24 bytes per CPU
            int bufSize = numCpus * structSize;
            IntPtr buf = Marshal.AllocHGlobal(bufSize);
            try
            {
                int status = NtPowerInformation(ProcessorInformation, IntPtr.Zero, 0, buf, bufSize);
                if (status != 0)
                {
                    Console.WriteLine("{\"cpuFreq\":null}");
                    return;
                }

                // Read first CPU's MhzLimit as the representative frequency
                // All cores usually have the same frequency on modern CPUs
                uint maxMhz = (uint)Marshal.ReadInt32(buf, 4);
                uint curMhz = (uint)Marshal.ReadInt32(buf, 8);
                uint mhzLimit = (uint)Marshal.ReadInt32(buf, 12);

                // Use MhzLimit as primary (most accurate real-time value),
                // fallback to CurrentMhz
                uint freq = mhzLimit > 0 ? mhzLimit : curMhz;

                Console.WriteLine("{\"cpuFreq\":" + freq + "}");
            }
            finally
            {
                Marshal.FreeHGlobal(buf);
            }
        }
        catch
        {
            Console.WriteLine("{\"cpuFreq\":null}");
        }
    }

    static void QuerySmbios()
    {
        uint sig = 0x52534D42;
        uint sz = GetSystemFirmwareTable(sig, 0, null, 0);
        if (sz == 0) { Console.WriteLine("{\"total\":-1,\"used\":-1}"); return; }

        byte[] buf = new byte[sz];
        GetSystemFirmwareTable(sig, 0, buf, sz);

        int offset = 8;
        int total = 0;
        int used = 0;

        while (offset < buf.Length - 4)
        {
            byte type = buf[offset];
            byte len = buf[offset + 1];
            if (len < 4 || offset + len > buf.Length) break;

            if (type == 17)
            {
                total++;
                if (len >= 0x0E && offset + 0x0E <= buf.Length)
                {
                    ushort memSize = BitConverter.ToUInt16(buf, offset + 0x0C);
                    bool populated = false;
                    if (memSize != 0 && memSize != 0xFFFF) populated = true;
                    if (memSize == 0x7FFF && len >= 0x20 && offset + 0x20 <= buf.Length)
                    {
                        uint ext = BitConverter.ToUInt32(buf, offset + 0x1C);
                        if (ext != 0) populated = true;
                    }
                    if (populated) used++;
                }
            }

            offset += len;
            while (offset < buf.Length - 1)
            {
                if (buf[offset] == 0 && buf[offset + 1] == 0) { offset += 2; break; }
                offset++;
            }
        }
        Console.WriteLine("{\"total\":" + total + ",\"used\":" + used + "}");
    }
}
