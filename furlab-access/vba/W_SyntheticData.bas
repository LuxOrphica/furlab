Attribute VB_Name = "W_SyntheticData"
Option Compare Database
Option Explicit

Private mRndSeeded As Boolean
Private Const SYN_MIN_VERTICES As Long = 4
Private Const SYN_MAX_VERTICES As Long = 15

' Keeps existing public entry point name.
Public Sub W_GenerateSyntheticScrapPieces()
    W_GenerateSyntheticScrapPiecesN 40
End Sub

' Generates synthetic ScrapPiece rows with organic closed contours.
Public Sub W_GenerateSyntheticScrapPiecesN(ByVal pieceCount As Long)
    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim rs As DAO.Recordset
    Dim mats As Collection
    Dim locs As Collection
    Dim i As Long
    Dim tryNo As Long
    Dim okShape As Boolean
    Dim inventoryTag As String
    Dim statusCode As String
    Dim qualityCode As String
    Dim materialId As String
    Dim locationId As String
    Dim napDeg As Double
    Dim vCount As Long
    Dim points As Variant
    Dim areaMm2 As Double
    Dim bboxW As Double
    Dim bboxH As Double
    Dim maxSpan As Double
    Dim contourJson As String
    Dim metricsJson As String
    Dim nextTagNo As Long
    Dim hasDiscarded As Boolean
    Dim nowVal As Date
    Dim targetW As Double
    Dim targetH As Double
    Dim stretchK As Double

    If pieceCount < 1 Then
        MsgBox "pieceCount must be >= 1", vbExclamation
        Exit Sub
    End If

    SeedRndOnce
    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)
    Set mats = LoadGuidList("FurMaterial")
    Set locs = LoadGuidList("StorageLocation")

    If mats.Count = 0 Then
        MsgBox "No FurMaterial rows found.", vbExclamation
        Exit Sub
    End If
    If locs.Count = 0 Then
        MsgBox "No StorageLocation rows found.", vbExclamation
        Exit Sub
    End If

    hasDiscarded = (DCount("*", "ScrapStatusDict", "code='Discarded'") > 0)
    nextTagNo = NextSyntheticTagNo(db)
    nowVal = Now
    Set rs = db.OpenRecordset("ScrapPiece", dbOpenDynaset)

    wrk.BeginTrans
    On Error GoTo GenErr

    For i = 1 To pieceCount
        napDeg = Round(Rnd() * 359.9, 1)
        vCount = SYN_MIN_VERTICES + Int(Rnd() * (SYN_MAX_VERTICES - SYN_MIN_VERTICES + 1)) ' 4..15
        okShape = False

        For tryNo = 1 To 30
            points = GenerateOrganicClosedPolygon(vCount)
            targetW = 80# + Rnd() * 270#
            targetH = 80# + Rnd() * 270#
            NormalizePolygonToBbox points, targetW, targetH

            stretchK = PickNapStretchFactor()
            StretchPolygonAlongNap points, napDeg, stretchK

            areaMm2 = PolygonArea(points)
            bboxW = PolygonBboxWidth(points)
            bboxH = PolygonBboxHeight(points)

            If areaMm2 > 0# Then
                If areaMm2 < 5000# Or areaMm2 > 60000# Then
                    points = RescalePolygon(points, Sqr(IIf(areaMm2 < 5000#, 5000# / areaMm2, 60000# / areaMm2)))
                    areaMm2 = PolygonArea(points)
                    bboxW = PolygonBboxWidth(points)
                    bboxH = PolygonBboxHeight(points)
                End If
            End If

            If areaMm2 >= 5000# And areaMm2 <= 60000# _
               And bboxW >= 80# And bboxW <= 350# _
               And bboxH >= 80# And bboxH <= 350# _
               And IsSimpleClosedPolygon(points) Then
                okShape = True
                Exit For
            End If
        Next tryNo

        If Not okShape Then
            Err.Raise vbObjectError + 820, "W_SyntheticData", "Unable to generate valid simple contour for piece #" & CStr(i)
        End If

        inventoryTag = "FL-SCR-" & Right$("000000" & CStr(nextTagNo), 6)
        nextTagNo = nextTagNo + 1
        statusCode = PickStatusCode(hasDiscarded)
        qualityCode = PickQualityCode()
        materialId = CStr(mats.Item(1 + Int(Rnd() * mats.Count)))
        locationId = CStr(locs.Item(1 + Int(Rnd() * locs.Count)))
        maxSpan = PolygonMaxSpan(points)
        contourJson = BuildContourJson(points)

        metricsJson = "{""areaMm2"":" & FmtNum(areaMm2) & _
                      ",""bboxWidthMm"":" & FmtNum(bboxW) & _
                      ",""bboxHeightMm"":" & FmtNum(bboxH) & _
                      ",""maxSpanMm"":" & FmtNum(maxSpan) & _
                      ",""status"":""" & statusCode & """" & _
                      ",""quality"":""" & qualityCode & """" & _
                      ",""vertexCount"":" & CStr(UBound(points, 1)) & "}"

        rs.AddNew
        rs.Fields("id").Value = GuidForField(GenerateGuidLike())
        rs.Fields("inventoryTag").Value = inventoryTag
        rs.Fields("materialId").Value = GuidForField(materialId)
        rs.Fields("storageLocationId").Value = GuidForField(locationId)
        rs.Fields("napDirectionDeg").Value = napDeg
        rs.Fields("scrapContour").Value = contourJson
        rs.Fields("areaMm2").Value = areaMm2
        rs.Fields("bboxWidthMm").Value = bboxW
        rs.Fields("bboxHeightMm").Value = bboxH
        rs.Fields("maxSpanMm").Value = maxSpan
        rs.Fields("scrapStatus").Value = statusCode
        rs.Fields("scrapQuality").Value = qualityCode
        rs.Fields("note").Value = Null
        rs.Fields("createdAt").Value = nowVal
        rs.Fields("updatedAt").Value = nowVal
        On Error Resume Next
        rs.Fields("metricsJson").Value = metricsJson
        Err.Clear
        On Error GoTo GenErr
        rs.Update

        If (i Mod 10) = 0 Then
            Debug.Print "W synthetic progress: " & i & "/" & pieceCount
        End If
    Next i

    wrk.CommitTrans
    rs.Close
    MsgBox "Synthetic ScrapPiece generated: " & pieceCount, vbInformation, "W synthetic"
    Exit Sub

GenErr:
    Dim errNo As Long
    Dim errMsg As String
    errNo = Err.Number
    errMsg = Err.Description
    If Len(errMsg) = 0 Then errMsg = "(empty description)"
    On Error Resume Next
    wrk.Rollback
    If Not rs Is Nothing Then rs.Close
    MsgBox "Synthetic generation failed. Err " & errNo & ": " & errMsg, vbCritical, "W synthetic"
End Sub

' Additional helper requested by user:
' creates simple fragment rows F-01..F-n for existing Zone IDs.
Public Sub W_GenerateSyntheticFragments(Optional ByVal n As Long = 30)
    Dim db As DAO.Database
    Dim rsF As DAO.Recordset
    Dim zones As Collection
    Dim i As Long
    Dim codeVal As String
    Dim zoneId As String
    Dim inserted As Long

    If n < 1 Then Exit Sub
    SeedRndOnce

    Set db = CurrentDb
    Set zones = LoadGuidList("Zone")
    If zones.Count = 0 Then
        MsgBox "No Zone rows found - skipped.", vbExclamation, "W synthetic"
        Exit Sub
    End If

    Set rsF = db.OpenRecordset("Fragment", dbOpenDynaset)
    On Error GoTo FragErr

    For i = 1 To n
        codeVal = "F-" & Right$("00" & CStr(i), 2)
        If DCount("*", "Fragment", "fragmentCode=" & SqlText(codeVal)) = 0 Then
            zoneId = CStr(zones.Item(1 + Int(Rnd() * zones.Count)))
            rsF.AddNew
            rsF.Fields("id").Value = GuidForField(GenerateGuidLike())
            rsF.Fields("zoneId").Value = GuidForField(zoneId)
            rsF.Fields("fragmentCode").Value = codeVal
            rsF.Fields("areaMm2").Value = Null
            rsF.Update
            inserted = inserted + 1
        End If
    Next i

    rsF.Close
    MsgBox "Synthetic Fragment inserted: " & inserted, vbInformation, "W synthetic"
    Exit Sub

FragErr:
    On Error Resume Next
    If Not rsF Is Nothing Then rsF.Close
    MsgBox "Fragment generation failed. Err " & Err.Number & ": " & Err.Description, vbCritical, "W synthetic"
End Sub

' Deletes only synthetic rows and their direct dependent rows.
Public Sub W_ClearSyntheticData()
    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim deletedPieces As Long
    Dim deletedFragments As Long

    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)

    wrk.BeginTrans
    On Error GoTo ClrErr

    ' Remove dependencies first (FK-safe).
    db.Execute "DELETE FROM LayoutRunScrapPlacement WHERE scrapPieceId IN (" & _
               "SELECT id FROM ScrapPiece WHERE inventoryTag Like 'FL-SCR-*' OR inventoryTag Like 'SYN-*')" _
               , dbFailOnError

    db.Execute "DELETE FROM ScrapReservation WHERE scrapPieceId IN (" & _
               "SELECT id FROM ScrapPiece WHERE inventoryTag Like 'FL-SCR-*' OR inventoryTag Like 'SYN-*')" _
               , dbFailOnError

    db.Execute "DELETE FROM ScrapTransaction WHERE scrapPieceId IN (" & _
               "SELECT id FROM ScrapPiece WHERE inventoryTag Like 'FL-SCR-*' OR inventoryTag Like 'SYN-*')" _
               , dbFailOnError

    db.Execute "DELETE FROM ScrapPiece WHERE inventoryTag Like 'FL-SCR-*' OR inventoryTag Like 'SYN-*'", dbFailOnError
    deletedPieces = db.RecordsAffected

    db.Execute "DELETE FROM Fragment WHERE fragmentCode Like 'F-##'", dbFailOnError
    deletedFragments = db.RecordsAffected

    wrk.CommitTrans
    MsgBox "Synthetic data cleared." & vbCrLf & _
           "ScrapPiece deleted: " & deletedPieces & vbCrLf & _
           "Fragment deleted: " & deletedFragments, vbInformation, "W synthetic"
    Exit Sub

ClrErr:
    On Error Resume Next
    wrk.Rollback
    MsgBox "Clear synthetic data failed. Err " & Err.Number & ": " & Err.Description, vbCritical, "W synthetic"
End Sub

' Clears obvious test placeholders from ScrapPiece.note.
Public Sub W_CleanupTestNotes()
    On Error GoTo Fail
    Dim db As DAO.Database
    Dim changed As Long
    Set db = CurrentDb

    db.Execute "UPDATE ScrapPiece " & _
               "SET [note]=Null " & _
               "WHERE [note] Is Not Null AND (" & _
               "LCase([note]) Like '*synthetic*' OR " & _
               "LCase([note]) Like '*synt*test*' OR " & _
               "LCase([note]) Like '*test*')", dbFailOnError
    changed = db.RecordsAffected

    MsgBox "Test comments cleaned: " & CStr(changed), vbInformation, "W synthetic"
    Exit Sub
Fail:
    MsgBox "Cleanup test notes failed: " & Err.Description, vbExclamation, "W synthetic"
End Sub

' One-command reset: clear synthetic rows and generate fresh data.
Public Sub W_ResetSyntheticData(Optional ByVal pieceCount As Long = 40, Optional ByVal fragmentCount As Long = 30)
    W_ClearSyntheticData
    W_GenerateSyntheticScrapPiecesN pieceCount
    W_GenerateSyntheticFragments fragmentCount
    W_ValidateSyntheticContours
End Sub

' Backfills usage history rows for pieces with status='Used'.
' Creates missing Layout/LayoutRun/Fragment rows as needed and does not duplicate placements.
Public Sub W_BackfillUsageForUsedPieces(Optional ByVal maxRows As Long = 0)
    On Error GoTo Fail

    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim rsUsed As DAO.Recordset
    Dim rsLayout As DAO.Recordset
    Dim rsRun As DAO.Recordset
    Dim rsFrag As DAO.Recordset
    Dim layoutId As String
    Dim runId As String
    Dim zoneId As String
    Dim pieceId As String
    Dim fragId As String
    Dim fragCode As String
    Dim contour As String
    Dim inserted As Long
    Dim skipped As Long
    Dim scanned As Long
    Dim q As String
    Dim errNo As Long
    Dim errMsg As String

    SeedRndOnce
    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)

    wrk.BeginTrans

    zoneId = EnsureSyntheticZone()
    If Len(zoneId) = 0 Then Err.Raise vbObjectError + 901, "W_SyntheticData", "Zone is empty. Cannot create usage rows."

    ' 1) Ensure one layout exists.
    Set rsLayout = db.OpenRecordset("SELECT TOP 1 id FROM Layout ORDER BY id;", dbOpenSnapshot)
    If Not rsLayout.EOF Then layoutId = NormalizeGuidText(rsLayout.Fields(0).Value)
    rsLayout.Close
    If Len(layoutId) = 0 Then
        layoutId = GenerateGuidLike()
        db.Execute "INSERT INTO Layout (id, zoneId, layoutType, paramsJson) VALUES (" & _
                   GuidSql(layoutId) & "," & GuidSql(zoneId) & "," & _
                   SqlText("synthetic") & "," & SqlText("{}") & ")", dbFailOnError
    End If

    ' 2) Create one run for this backfill batch.
    runId = GenerateGuidLike()
    db.Execute "INSERT INTO LayoutRun (id, layoutId, startedAt, paramsSnapshot, resultSnapshot) VALUES (" & _
               GuidSql(runId) & "," & GuidSql(layoutId) & ",Now()," & _
               SqlText("{""source"":""W_BackfillUsageForUsedPieces""}") & "," & SqlText("{}") & ")", dbFailOnError

    ' 3) Iterate used pieces without any placement yet.
    q = "SELECT sp.id, Nz(sp.scrapContour,'') AS contour " & _
        "FROM ScrapPiece AS sp " & _
        "WHERE LCase(Nz(sp.scrapStatus,''))='used' " & _
        "AND NOT EXISTS (SELECT 1 FROM LayoutRunScrapPlacement AS p WHERE p.scrapPieceId = sp.id) " & _
        "ORDER BY sp.inventoryTag;"
    Set rsUsed = db.OpenRecordset(q, dbOpenSnapshot)

    Do While Not rsUsed.EOF
        scanned = scanned + 1
        If maxRows > 0 And inserted >= maxRows Then Exit Do

        pieceId = NormalizeGuidText(rsUsed.Fields("id").Value)
        contour = Nz(rsUsed.Fields("contour").Value, "")

        ' unique fragment per placement to satisfy PK(layoutRunId, fragmentId)
        fragId = GenerateGuidLike()
        fragCode = BuildUniqueFragmentCode()

        db.Execute "INSERT INTO Fragment (id, zoneId, fragmentCode, fragmentContour, areaMm2) VALUES (" & _
                   GuidSql(fragId) & "," & GuidSql(zoneId) & "," & _
                   SqlText(fragCode) & "," & SqlText(contour) & ",Null)", dbFailOnError

        db.Execute "INSERT INTO LayoutRunScrapPlacement (" & _
                   "layoutRunId, fragmentId, scrapPieceId, rotationDeg, offsetXmm, offsetYmm, resultContourSnapshot" & _
                   ") VALUES (" & _
                   GuidSql(runId) & "," & GuidSql(fragId) & "," & GuidSql(pieceId) & "," & _
                   Replace(CStr(Round(Rnd() * 359.9, 1)), ",", ".") & "," & _
                   Replace(CStr(Round((Rnd() - 0.5) * 300, 1)), ",", ".") & "," & _
                   Replace(CStr(Round((Rnd() - 0.5) * 300, 1)), ",", ".") & "," & _
                   SqlText(contour) & ")", dbFailOnError

        inserted = inserted + 1
        rsUsed.MoveNext
    Loop
    rsUsed.Close

    ' Count used pieces that already had usage rows.
    skipped = DCount("*", "ScrapPiece", "LCase(Nz(scrapStatus,''))='used'") - inserted
    If skipped < 0 Then skipped = 0

    wrk.CommitTrans
    MsgBox "Usage backfill completed." & vbCrLf & _
           "Run id: " & runId & vbCrLf & _
           "Inserted rows: " & inserted & vbCrLf & _
           "Used pieces already linked/other: " & skipped, vbInformation, "W synthetic"
    Exit Sub

Fail:
    errNo = Err.Number
    errMsg = Err.Description
    If Len(errMsg) = 0 Then errMsg = "(empty description)"
    On Error Resume Next
    wrk.Rollback
    If Not rsUsed Is Nothing Then rsUsed.Close
    MsgBox "Usage backfill failed. Err " & errNo & ": " & errMsg, vbCritical, "W synthetic"
End Sub

' Rounds existing synthetic contour coordinates to 0.1 mm and recalculates metrics.
Public Sub W_RoundSyntheticContoursToTenthMm()
    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim rs As DAO.Recordset
    Dim contour As String
    Dim statusCode As String
    Dim qualityCode As String
    Dim points As Variant
    Dim rounded() As Double
    Dim i As Long
    Dim n As Long
    Dim total As Long
    Dim updated As Long
    Dim skipped As Long
    Dim areaMm2 As Double
    Dim bboxW As Double
    Dim bboxH As Double
    Dim maxSpan As Double
    Dim contourJson As String
    Dim metricsJson As String

    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)
    Set rs = db.OpenRecordset("SELECT * FROM ScrapPiece " & _
                              "WHERE inventoryTag Like 'FL-SCR-*' OR inventoryTag Like 'SYN-*' " & _
                              "ORDER BY inventoryTag;", dbOpenDynaset)

    wrk.BeginTrans
    On Error GoTo RoundErr

    Do While Not rs.EOF
        total = total + 1
        contour = Nz(rs.Fields("scrapContour").Value, "")

        If ValidateContourJson(contour, points) Then
            n = UBound(points, 1)
            ReDim rounded(0 To n, 0 To 1)

            For i = 0 To n
                rounded(i, 0) = Round(points(i, 0), 1)
                rounded(i, 1) = Round(points(i, 1), 1)
            Next i

            ' Keep explicit closure even after rounding.
            rounded(n, 0) = rounded(0, 0)
            rounded(n, 1) = rounded(0, 1)

            areaMm2 = PolygonArea(rounded)
            bboxW = PolygonBboxWidth(rounded)
            bboxH = PolygonBboxHeight(rounded)
            maxSpan = PolygonMaxSpan(rounded)
            contourJson = BuildContourJson(rounded)

            statusCode = Nz(rs.Fields("scrapStatus").Value, "")
            qualityCode = Nz(rs.Fields("scrapQuality").Value, "")
            metricsJson = "{""areaMm2"":" & FmtNum(areaMm2) & _
                          ",""bboxWidthMm"":" & FmtNum(bboxW) & _
                          ",""bboxHeightMm"":" & FmtNum(bboxH) & _
                          ",""maxSpanMm"":" & FmtNum(maxSpan) & _
                          ",""status"":""" & statusCode & """" & _
                          ",""quality"":""" & qualityCode & """" & _
                          ",""vertexCount"":" & CStr(n) & "}"

            rs.Edit
            rs.Fields("scrapContour").Value = contourJson
            rs.Fields("areaMm2").Value = areaMm2
            rs.Fields("bboxWidthMm").Value = bboxW
            rs.Fields("bboxHeightMm").Value = bboxH
            rs.Fields("maxSpanMm").Value = maxSpan
            rs.Fields("updatedAt").Value = Now
            On Error Resume Next
            rs.Fields("metricsJson").Value = metricsJson
            Err.Clear
            On Error GoTo RoundErr
            rs.Update
            updated = updated + 1
        Else
            skipped = skipped + 1
        End If

        rs.MoveNext
    Loop

    wrk.CommitTrans
    rs.Close

    MsgBox "Rounding completed (0.1 mm)." & vbCrLf & _
           "Checked: " & total & vbCrLf & _
           "Updated: " & updated & vbCrLf & _
           "Skipped: " & skipped, vbInformation, "W synthetic"
    Exit Sub

RoundErr:
    On Error Resume Next
    wrk.Rollback
    If Not rs Is Nothing Then rs.Close
    MsgBox "Rounding failed. Err " & Err.Number & ": " & Err.Description, vbCritical, "W synthetic"
End Sub

Private Sub SeedRndOnce()
    If Not mRndSeeded Then
        Randomize Timer
        mRndSeeded = True
    End If
End Sub

Private Function GenerateOrganicClosedPolygon(ByVal n As Long) As Variant
    Dim angles() As Double
    Dim radii() As Double
    Dim pts() As Double
    Dim i As Long
    Dim notchCount As Long
    Dim notchCenter(1 To 3) As Double
    Dim notchWidth(1 To 3) As Double
    Dim notchDepth(1 To 3) As Double
    Dim tailCenter As Double
    Dim tailWidth As Double
    Dim hasTail As Boolean
    Dim a As Double
    Dim r As Double
    Dim noiseA As Double
    Dim asymX As Double
    Dim asymY As Double

    ReDim angles(0 To n - 1)
    ReDim radii(0 To n - 1)
    ReDim pts(0 To n, 0 To 1) ' closed polygon: last point repeats first

    For i = 0 To n - 1
        angles(i) = Rnd() * 6.28318530717959
    Next i
    QuickSortSingle angles, 0, n - 1

    notchCount = 1 + Int(Rnd() * 3) ' 1..3
    For i = 1 To notchCount
        notchCenter(i) = Rnd() * 6.28318530717959
        notchWidth(i) = 0.22 + Rnd() * 0.28
        notchDepth(i) = 0.2 + Rnd() * 0.3 ' 20..50%
    Next i

    hasTail = (Rnd() < 0.35)
    tailCenter = Rnd() * 6.28318530717959
    tailWidth = 0.08 + Rnd() * 0.12

    asymX = 0.8 + Rnd() * 0.9
    asymY = 0.8 + Rnd() * 0.9

    For i = 0 To n - 1
        a = angles(i)
        noiseA = 0.86 + 0.22 * Sin(3# * a + 6.28318530717959 * Rnd()) + (Rnd() - 0.5) * 0.22
        r = 1# * noiseA

        ApplyNotches r, a, notchCount, notchCenter, notchWidth, notchDepth
        If hasTail Then ApplyTail r, a, tailCenter, tailWidth

        If r < 0.15 Then r = 0.15
        radii(i) = r
        pts(i, 0) = Cos(a) * radii(i) * asymX
        pts(i, 1) = Sin(a) * radii(i) * asymY
    Next i

    pts(n, 0) = pts(0, 0)
    pts(n, 1) = pts(0, 1)
    GenerateOrganicClosedPolygon = pts
End Function

Private Sub ApplyNotches(ByRef r As Double, ByVal angleVal As Double, ByVal notchCount As Long, _
                         ByRef centers() As Double, ByRef widths() As Double, ByRef depths() As Double)
    Dim i As Long
    Dim d As Double
    Dim k As Double
    For i = 1 To notchCount
        d = AngularDistance(angleVal, centers(i))
        If d < widths(i) Then
            k = d / widths(i)
            r = r * (1# - depths(i) * (1# - k * k))
        End If
    Next i
End Sub

Private Sub ApplyTail(ByRef r As Double, ByVal angleVal As Double, ByVal centerA As Double, ByVal widthA As Double)
    Dim d As Double
    Dim k As Double
    d = AngularDistance(angleVal, centerA)
    If d < widthA Then
        k = 1# - (d / widthA)
        r = r * (1# + 0.45 * k)
    End If
End Sub

Private Function AngularDistance(ByVal a As Double, ByVal b As Double) As Double
    Dim d As Double
    d = Abs(a - b)
    If d > 3.14159265358979 Then d = 6.28318530717959 - d
    AngularDistance = d
End Function

Private Function PickNapStretchFactor() As Double
    ' Most pieces are slightly elongated along nap direction.
    If Rnd() < 0.75 Then
        PickNapStretchFactor = 1.1 + Rnd() * 0.45    ' 1.10..1.55
    Else
        PickNapStretchFactor = 0.95 + Rnd() * 0.12   ' 0.95..1.07
    End If
End Function

Private Sub StretchPolygonAlongNap(ByRef points As Variant, ByVal napDeg As Double, ByVal stretchK As Double)
    Dim i As Long
    Dim n As Long
    Dim rad As Double
    Dim ux As Double, uy As Double
    Dim vx As Double, vy As Double
    Dim x As Double, y As Double
    Dim par As Double, per As Double
    Dim invK As Double

    If stretchK <= 0# Then Exit Sub
    n = UBound(points, 1)
    If n < 1 Then Exit Sub

    rad = napDeg * 3.14159265358979 / 180#
    ux = Cos(rad): uy = Sin(rad)
    vx = -uy: vy = ux
    invK = 1# / Sqr(stretchK)

    For i = 0 To n - 1
        x = points(i, 0)
        y = points(i, 1)

        par = x * ux + y * uy
        per = x * vx + y * vy

        par = par * stretchK
        per = per * invK

        points(i, 0) = par * ux + per * vx
        points(i, 1) = par * uy + per * vy
    Next i

    points(n, 0) = points(0, 0)
    points(n, 1) = points(0, 1)
End Sub

Private Sub NormalizePolygonToBbox(ByRef points As Variant, ByVal targetW As Double, ByVal targetH As Double)
    Dim i As Long
    Dim n As Long
    Dim minX As Double, maxX As Double, minY As Double, maxY As Double
    Dim w As Double, h As Double
    Dim sx As Double, sy As Double
    Dim cx As Double, cy As Double

    n = UBound(points, 1)
    minX = points(0, 0): maxX = points(0, 0)
    minY = points(0, 1): maxY = points(0, 1)
    For i = 1 To n - 1
        If points(i, 0) < minX Then minX = points(i, 0)
        If points(i, 0) > maxX Then maxX = points(i, 0)
        If points(i, 1) < minY Then minY = points(i, 1)
        If points(i, 1) > maxY Then maxY = points(i, 1)
    Next i
    w = maxX - minX: If w = 0# Then w = 1#
    h = maxY - minY: If h = 0# Then h = 1#
    sx = targetW / w
    sy = targetH / h

    cx = (minX + maxX) / 2#
    cy = (minY + maxY) / 2#
    For i = 0 To n - 1
        points(i, 0) = (points(i, 0) - cx) * sx
        points(i, 1) = (points(i, 1) - cy) * sy
    Next i
    points(n, 0) = points(0, 0)
    points(n, 1) = points(0, 1)
End Sub

Private Function RescalePolygon(ByVal points As Variant, ByVal scaleK As Double) As Variant
    Dim i As Long
    Dim n As Long
    Dim outPts() As Double
    n = UBound(points, 1)
    ReDim outPts(0 To n, 0 To 1)
    For i = 0 To n
        outPts(i, 0) = points(i, 0) * scaleK
        outPts(i, 1) = points(i, 1) * scaleK
    Next i
    outPts(n, 0) = outPts(0, 0)
    outPts(n, 1) = outPts(0, 1)
    RescalePolygon = outPts
End Function

Private Function IsSimpleClosedPolygon(ByVal points As Variant) As Boolean
    Dim n As Long
    Dim i As Long, j As Long
    Dim ax1 As Double, ay1 As Double, ax2 As Double, ay2 As Double
    Dim bx1 As Double, by1 As Double, bx2 As Double, by2 As Double

    n = UBound(points, 1) - 1
    If n < 3 Then
        IsSimpleClosedPolygon = False
        Exit Function
    End If

    For i = 0 To n - 1
        ax1 = points(i, 0): ay1 = points(i, 1)
        ax2 = points(i + 1, 0): ay2 = points(i + 1, 1)
        For j = i + 1 To n - 1
            If Abs(i - j) <= 1 Then GoTo NextPair
            If i = 0 And j = n - 1 Then GoTo NextPair
            bx1 = points(j, 0): by1 = points(j, 1)
            bx2 = points(j + 1, 0): by2 = points(j + 1, 1)
            If SegmentsIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) Then
                IsSimpleClosedPolygon = False
                Exit Function
            End If
NextPair:
        Next j
    Next i

    IsSimpleClosedPolygon = True
End Function

Private Function SegmentsIntersect(ByVal ax1 As Double, ByVal ay1 As Double, ByVal ax2 As Double, ByVal ay2 As Double, _
                                   ByVal bx1 As Double, ByVal by1 As Double, ByVal bx2 As Double, ByVal by2 As Double) As Boolean
    Dim d1 As Double, d2 As Double, d3 As Double, d4 As Double
    d1 = Cross(ax1, ay1, ax2, ay2, bx1, by1)
    d2 = Cross(ax1, ay1, ax2, ay2, bx2, by2)
    d3 = Cross(bx1, by1, bx2, by2, ax1, ay1)
    d4 = Cross(bx1, by1, bx2, by2, ax2, ay2)
    SegmentsIntersect = ((d1 > 0# And d2 < 0#) Or (d1 < 0# And d2 > 0#)) _
                     And ((d3 > 0# And d4 < 0#) Or (d3 < 0# And d4 > 0#))
End Function

Private Function Cross(ByVal x1 As Double, ByVal y1 As Double, ByVal x2 As Double, ByVal y2 As Double, ByVal x3 As Double, ByVal y3 As Double) As Double
    Cross = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)
End Function

Private Function PolygonArea(ByVal points As Variant) As Double
    Dim i As Long
    Dim n As Long
    Dim s As Double
    n = UBound(points, 1) - 1
    s = 0#
    For i = 0 To n - 1
        s = s + (points(i, 0) * points(i + 1, 1) - points(i + 1, 0) * points(i, 1))
    Next i
    PolygonArea = Abs(s) / 2#
End Function

Private Function PolygonBboxWidth(ByVal points As Variant) As Double
    Dim i As Long, n As Long
    Dim mn As Double, mx As Double
    n = UBound(points, 1) - 1
    mn = points(0, 0): mx = points(0, 0)
    For i = 1 To n
        If points(i, 0) < mn Then mn = points(i, 0)
        If points(i, 0) > mx Then mx = points(i, 0)
    Next i
    PolygonBboxWidth = mx - mn
End Function

Private Function PolygonBboxHeight(ByVal points As Variant) As Double
    Dim i As Long, n As Long
    Dim mn As Double, mx As Double
    n = UBound(points, 1) - 1
    mn = points(0, 1): mx = points(0, 1)
    For i = 1 To n
        If points(i, 1) < mn Then mn = points(i, 1)
        If points(i, 1) > mx Then mx = points(i, 1)
    Next i
    PolygonBboxHeight = mx - mn
End Function

Private Function PolygonMaxSpan(ByVal points As Variant) As Double
    Dim i As Long, j As Long, n As Long
    Dim dx As Double, dy As Double, d As Double, m As Double
    n = UBound(points, 1) - 1
    m = 0#
    For i = 0 To n - 1
        For j = i + 1 To n - 1
            dx = points(i, 0) - points(j, 0)
            dy = points(i, 1) - points(j, 1)
            d = Sqr(dx * dx + dy * dy)
            If d > m Then m = d
        Next j
    Next i
    PolygonMaxSpan = m
End Function

Private Function BuildContourJson(ByVal points As Variant) As String
    Dim i As Long
    Dim n As Long
    Dim s As String
    n = UBound(points, 1)
    s = "{""units"":""mm"",""path"":["
    For i = 0 To n
        If i > 0 Then s = s & ","
        s = s & "{""x"":" & FmtNum(points(i, 0)) & ",""y"":" & FmtNum(points(i, 1)) & "}"
    Next i
    s = s & "]}"
    BuildContourJson = s
End Function

Private Function PickStatusCode(ByVal hasDiscarded As Boolean) As String
    Dim r As Double
    r = Rnd()
    If hasDiscarded And r >= 0.97 Then
        PickStatusCode = "Discarded"
    ElseIf r < 0.7 Then
        PickStatusCode = "Available"
    ElseIf r < 0.9 Then
        PickStatusCode = "Reserved"
    Else
        PickStatusCode = "Used"
    End If
End Function

Private Function PickQualityCode() As String
    If Rnd() < 0.8 Then
        PickQualityCode = "Good"
    Else
        PickQualityCode = "Limited"
    End If
End Function

Private Function LoadGuidList(ByVal tableName As String) As Collection
    Dim rs As DAO.Recordset
    Dim c As New Collection
    Set rs = CurrentDb.OpenRecordset("SELECT id FROM " & tableName & ";", dbOpenSnapshot)
    Do While Not rs.EOF
        c.Add NormalizeGuidText(rs.Fields(0).Value)
        rs.MoveNext
    Loop
    rs.Close
    Set LoadGuidList = c
End Function

Private Function GuidForField(ByVal guidValue As String) As String
    GuidForField = "{" & NormalizeGuidText(guidValue) & "}"
End Function

Private Function GuidSql(ByVal guidValue As String) As String
    GuidSql = "{" & NormalizeGuidText(guidValue) & "}"
End Function

Private Function FirstGuidOrEmpty(ByVal tableName As String) As String
    Dim rs As DAO.Recordset
    Set rs = CurrentDb.OpenRecordset("SELECT TOP 1 id FROM " & tableName & " ORDER BY id;", dbOpenSnapshot)
    If rs.EOF Then
        FirstGuidOrEmpty = ""
    Else
        FirstGuidOrEmpty = NormalizeGuidText(rs.Fields(0).Value)
    End If
    rs.Close
End Function

Private Function EnsureSyntheticZone() As String
    On Error GoTo Fail
    Dim db As DAO.Database
    Dim zoneId As String
    Dim partId As String

    Set db = CurrentDb
    zoneId = FirstGuidOrEmpty("Zone")
    If Len(zoneId) > 0 Then
        EnsureSyntheticZone = zoneId
        Exit Function
    End If

    partId = FirstGuidOrEmpty("Part")
    If Len(partId) = 0 Then
        partId = GenerateGuidLike()
        db.Execute "INSERT INTO Part (id, partNo, partName) VALUES (" & _
                   GuidSql(partId) & ", 0, " & SqlText("Synthetic part") & ")", dbFailOnError
    End If

    zoneId = GenerateGuidLike()
    db.Execute "INSERT INTO Zone (id, partId, zoneNo, zoneContour, materialId, pileDirectionDeg) VALUES (" & _
               GuidSql(zoneId) & ", " & GuidSql(partId) & ", 1, " & SqlText("{}") & ", Null, 0)", dbFailOnError
    EnsureSyntheticZone = zoneId
    Exit Function
Fail:
    EnsureSyntheticZone = ""
End Function

Private Function NextSyntheticTagNo(ByVal db As DAO.Database) As Long
    Dim rs As DAO.Recordset
    Dim maxNo As Long
    Set rs = db.OpenRecordset("SELECT Max(Val(Mid([inventoryTag],8))) AS mx FROM ScrapPiece WHERE inventoryTag Like 'FL-SCR-*';", dbOpenSnapshot)
    maxNo = 0
    If Not rs.EOF Then
        If Not IsNull(rs.Fields(0).Value) Then maxNo = CLng(rs.Fields(0).Value)
    End If
    rs.Close
    NextSyntheticTagNo = maxNo + 1
End Function

Private Function SqlText(ByVal s As String) As String
    SqlText = "'" & Replace(s, "'", "''") & "'"
End Function

Private Function FmtNum(ByVal d As Double) As String
    FmtNum = Replace(Format$(d, "0.0"), ",", ".")
End Function

Private Function NormalizeGuidText(ByVal valueVal As Variant) As String
    Dim s As String
    Dim p1 As Long
    Dim p2 As Long

    s = Trim$(CStr(valueVal))
    p1 = InStr(1, s, "{")
    p2 = InStrRev(s, "}")
    If p1 > 0 And p2 > p1 Then
        NormalizeGuidText = Mid$(s, p1 + 1, p2 - p1 - 1)
    Else
        s = Replace(s, "[guid", "", , , vbTextCompare)
        s = Replace(s, "]", "")
        s = Replace(s, "{", "")
        s = Replace(s, "}", "")
        NormalizeGuidText = Trim$(s)
    End If
End Function

Private Function GenerateGuidLike() As String
    Dim s As String
    Dim i As Long
    s = ""
    For i = 1 To 32
        s = s & Mid$("0123456789abcdef", Int(Rnd() * 16) + 1, 1)
    Next i
    Mid$(s, 13, 1) = "4"
    Mid$(s, 17, 1) = Mid$("89ab", Int(Rnd() * 4) + 1, 1)
    GenerateGuidLike = Left$(s, 8) & "-" & Mid$(s, 9, 4) & "-" & Mid$(s, 13, 4) & "-" & Mid$(s, 17, 4) & "-" & Right$(s, 12)
End Function

Private Function BuildUniqueFragmentCode() As String
    BuildUniqueFragmentCode = "U-" & Format$(Now, "yymmddhhnnss") & "-" & Right$("000" & CStr(Int(Rnd() * 1000)), 3)
End Function

Private Sub QuickSortSingle(ByRef arr() As Double, ByVal lo As Long, ByVal hi As Long)
    Dim i As Long, j As Long
    Dim p As Double
    Dim t As Double
    i = lo
    j = hi
    p = arr((lo + hi) \ 2)
    Do While i <= j
        Do While arr(i) < p
            i = i + 1
        Loop
        Do While arr(j) > p
            j = j - 1
        Loop
        If i <= j Then
            t = arr(i): arr(i) = arr(j): arr(j) = t
            i = i + 1: j = j - 1
        End If
    Loop
    If lo < j Then QuickSortSingle arr, lo, j
    If i < hi Then QuickSortSingle arr, i, hi
End Sub

' Validates generated contours for FL-SCR-* rows.
Public Sub W_ValidateSyntheticContours()
    Dim db As DAO.Database
    Dim rs As DAO.Recordset
    Dim tagVal As String
    Dim contour As String
    Dim points As Variant
    Dim ok As Boolean
    Dim total As Long
    Dim bad As Long
    Dim msg As String

    Set db = CurrentDb
    Set rs = db.OpenRecordset("SELECT inventoryTag, scrapContour FROM ScrapPiece " & _
                              "WHERE inventoryTag Like 'FL-SCR-*' OR inventoryTag Like 'SYN-*' " & _
                              "ORDER BY inventoryTag;", dbOpenSnapshot)

    msg = ""
    Do While Not rs.EOF
        total = total + 1
        tagVal = Nz(rs.Fields("inventoryTag").Value, "")
        contour = Nz(rs.Fields("scrapContour").Value, "")
        ok = ValidateContourJson(contour, points)
        If Not ok Then
            bad = bad + 1
            If bad <= 20 Then msg = msg & vbCrLf & "- " & tagVal
        End If
        rs.MoveNext
    Loop
    rs.Close

    If bad = 0 Then
        MsgBox "Contour validation passed. Checked: " & total & ", bad: 0", vbInformation, "W synthetic"
    Else
        MsgBox "Contour validation completed. Checked: " & total & ", bad: " & bad & vbCrLf & "Examples:" & msg, vbExclamation, "W synthetic"
    End If
End Sub

' Regenerates contour only for invalid FL-SCR-* rows.
Public Sub W_FixSyntheticContours()
    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim rs As DAO.Recordset
    Dim tagVal As String
    Dim contour As String
    Dim points As Variant
    Dim ok As Boolean
    Dim fixed As Long
    Dim checked As Long
    Dim vCount As Long
    Dim tryNo As Long
    Dim areaMm2 As Double
    Dim bboxW As Double
    Dim bboxH As Double
    Dim maxSpan As Double
    Dim newContour As String
    Dim napDeg As Double

    SeedRndOnce
    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)
    Set rs = db.OpenRecordset("SELECT * FROM ScrapPiece " & _
                              "WHERE inventoryTag Like 'FL-SCR-*' OR inventoryTag Like 'SYN-*' " & _
                              "ORDER BY inventoryTag;", dbOpenDynaset)

    wrk.BeginTrans
    On Error GoTo FixErr

    Do While Not rs.EOF
        checked = checked + 1
        tagVal = Nz(rs.Fields("inventoryTag").Value, "")
        contour = Nz(rs.Fields("scrapContour").Value, "")
        ok = ValidateContourJson(contour, points)

        If Not ok Then
            For tryNo = 1 To 30
                napDeg = Round(Rnd() * 359.9, 1)
                vCount = SYN_MIN_VERTICES + Int(Rnd() * (SYN_MAX_VERTICES - SYN_MIN_VERTICES + 1))
                points = GenerateOrganicClosedPolygon(vCount)
                NormalizePolygonToBbox points, 80# + Rnd() * 270#, 80# + Rnd() * 270#
                StretchPolygonAlongNap points, napDeg, PickNapStretchFactor()
                areaMm2 = PolygonArea(points)
                If areaMm2 > 0# And (areaMm2 < 5000# Or areaMm2 > 60000#) Then
                    points = RescalePolygon(points, Sqr(IIf(areaMm2 < 5000#, 5000# / areaMm2, 60000# / areaMm2)))
                End If
                If ValidateContourPoints(points) Then Exit For
            Next tryNo

            If ValidateContourPoints(points) Then
                areaMm2 = PolygonArea(points)
                bboxW = PolygonBboxWidth(points)
                bboxH = PolygonBboxHeight(points)
                maxSpan = PolygonMaxSpan(points)
                newContour = BuildContourJson(points)

                rs.Edit
                rs.Fields("scrapContour").Value = newContour
                rs.Fields("areaMm2").Value = areaMm2
                rs.Fields("bboxWidthMm").Value = bboxW
                rs.Fields("bboxHeightMm").Value = bboxH
                rs.Fields("maxSpanMm").Value = maxSpan
                rs.Fields("napDirectionDeg").Value = napDeg
                rs.Fields("updatedAt").Value = Now
                rs.Update
                fixed = fixed + 1
            End If
        End If
        rs.MoveNext
    Loop

    wrk.CommitTrans
    rs.Close
    MsgBox "Contour fix completed. Checked: " & checked & ", fixed: " & fixed, vbInformation, "W synthetic"
    Exit Sub

FixErr:
    On Error Resume Next
    wrk.Rollback
    If Not rs Is Nothing Then rs.Close
    MsgBox "Contour fix failed. Err " & Err.Number & ": " & Err.Description, vbCritical, "W synthetic"
End Sub

Private Function ValidateContourJson(ByVal contourJson As String, ByRef points As Variant) As Boolean
    Dim xs() As Double
    Dim ys() As Double
    Dim cnt As Long
    Dim i As Long
    If Not ParseContourPointsFromJson(contourJson, xs, ys, cnt) Then
        ValidateContourJson = False
        Exit Function
    End If
    ReDim points(0 To cnt - 1, 0 To 1)
    For i = 0 To cnt - 1
        points(i, 0) = xs(i)
        points(i, 1) = ys(i)
    Next i
    ValidateContourJson = ValidateContourPoints(points)
End Function

Private Function ValidateContourPoints(ByVal points As Variant) As Boolean
    Dim n As Long
    Dim areaMm2 As Double
    Dim bboxW As Double
    Dim bboxH As Double
    n = UBound(points, 1)
    ' Closed contour contains one repeated endpoint:
    ' allowed source vertices 4..15 => stored points count 5..16 => last index 4..15.
    If n < SYN_MIN_VERTICES Or n > SYN_MAX_VERTICES Then
        ValidateContourPoints = False
        Exit Function
    End If
    If Abs(points(0, 0) - points(n, 0)) > 0.0001 Or Abs(points(0, 1) - points(n, 1)) > 0.0001 Then
        ValidateContourPoints = False
        Exit Function
    End If
    If Not IsSimpleClosedPolygon(points) Then
        ValidateContourPoints = False
        Exit Function
    End If
    areaMm2 = PolygonArea(points)
    bboxW = PolygonBboxWidth(points)
    bboxH = PolygonBboxHeight(points)
    ValidateContourPoints = (areaMm2 >= 5000# And areaMm2 <= 60000# And bboxW >= 80# And bboxW <= 350# And bboxH >= 80# And bboxH <= 350#)
End Function

Private Function ParseContourPointsFromJson(ByVal jsonText As String, ByRef xs() As Double, ByRef ys() As Double, ByRef cnt As Long) As Boolean
    Dim pos As Long
    Dim px As Long, py As Long
    Dim nx As Long, ny As Long
    Dim sx As String, sy As String

    cnt = 0
    pos = 1
    Do
        px = InStr(pos, jsonText, """x""", vbTextCompare)
        If px = 0 Then Exit Do
        px = InStr(px, jsonText, ":", vbTextCompare)
        If px = 0 Then Exit Do
        sx = ReadNumberToken(jsonText, px + 1, nx)
        If Len(sx) = 0 Then Exit Do

        py = InStr(nx, jsonText, """y""", vbTextCompare)
        If py = 0 Then Exit Do
        py = InStr(py, jsonText, ":", vbTextCompare)
        If py = 0 Then Exit Do
        sy = ReadNumberToken(jsonText, py + 1, ny)
        If Len(sy) = 0 Then Exit Do

        ReDim Preserve xs(0 To cnt)
        ReDim Preserve ys(0 To cnt)
        xs(cnt) = ToDoubleInvariant(sx)
        ys(cnt) = ToDoubleInvariant(sy)
        cnt = cnt + 1
        pos = ny + 1
    Loop

    ParseContourPointsFromJson = (cnt >= 4)
End Function

Private Function ReadNumberToken(ByVal s As String, ByVal startPos As Long, ByRef nextPos As Long) As String
    Dim i As Long
    Dim ch As String
    Dim token As String

    i = startPos
    Do While i <= Len(s)
        ch = Mid$(s, i, 1)
        If ch = " " Or ch = vbTab Or ch = vbCr Or ch = vbLf Then
            i = i + 1
        Else
            Exit Do
        End If
    Loop

    token = ""
    Do While i <= Len(s)
        ch = Mid$(s, i, 1)
        If (ch >= "0" And ch <= "9") Or ch = "+" Or ch = "-" Or ch = "." Or ch = "," Or ch = "e" Or ch = "E" Then
            token = token & ch
            i = i + 1
        Else
            Exit Do
        End If
    Loop

    nextPos = i
    ReadNumberToken = token
End Function

Private Function ToDoubleInvariant(ByVal s As String) As Double
    Dim t As String
    t = Trim$(s)
    t = Replace(t, ",", ".")
    ToDoubleInvariant = Val(t)
End Function
