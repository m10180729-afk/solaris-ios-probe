int passed = 0;
await RtpAdapterTests.Run((value, message) => {
    if (!value) throw new Exception(message);
    passed++;
    Console.WriteLine("PASS: " + message);
});
Console.WriteLine($"PASS: {passed} native RTP adapter lifecycle and peer isolation checks; no hardware capture test.");
