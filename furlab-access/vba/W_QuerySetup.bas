Attribute VB_Name = "W_QuerySetup"
Option Compare Database
Option Explicit

Public Function W_UiLangIsRu() As Boolean
    On Error GoTo Fail
    Dim v As Variant
    Dim s As String

    v = DLookup("cfgValue", "AppConfig", "cfgKey='ui.lang'")
    If IsNull(v) Then
        W_UiLangIsRu = False
        Exit Function
    End If

    s = LCase$(Trim$(CStr(v)))
    W_UiLangIsRu = (s = "ru")
    Exit Function
Fail:
    W_UiLangIsRu = False
End Function

Public Function W_StatusLabel(ByVal statusCode As Variant) As String
    On Error GoTo Fallback
    Dim s As String
    s = Nz(statusCode, "")

    Select Case LCase$(Trim$(s))
        Case "available"
            W_StatusLabel = W_UiTextSafe("status.available", "Available")
        Case "reserved"
            W_StatusLabel = W_UiTextSafe("status.reserved", "Reserved")
        Case "used"
            W_StatusLabel = W_UiTextSafe("status.used", "Used")
        Case "discarded"
            W_StatusLabel = W_UiTextSafe("status.discarded", "Discarded")
        Case Else
            W_StatusLabel = s
    End Select
    Exit Function
Fallback:
    W_StatusLabel = s
End Function

Public Function W_QualityLabel(ByVal qualityCode As Variant) As String
    On Error GoTo Fallback
    Dim s As String
    s = Nz(qualityCode, "")

    Select Case LCase$(Trim$(s))
        Case "good"
            W_QualityLabel = W_UiTextSafe("quality.good", "Good")
        Case "limited"
            W_QualityLabel = W_UiTextSafe("quality.limited", "Limited")
        Case Else
            W_QualityLabel = s
    End Select
    Exit Function
Fallback:
    W_QualityLabel = s
End Function

Public Function W_TransTypeLabel(ByVal transTypeCode As Variant) As String
    On Error GoTo Fallback
    Dim s As String
    s = Nz(transTypeCode, "")

    Select Case LCase$(Trim$(s))
        Case "reserve"
            W_TransTypeLabel = W_UiTextSafe("f3.btn.reserve", "Reserve")
        Case "release"
            W_TransTypeLabel = W_UiTextSafe("f3.btn.release", "Release reservation")
        Case Else
            W_TransTypeLabel = s
    End Select
    Exit Function
Fallback:
    W_TransTypeLabel = s
End Function

Public Sub W_CreateStage2Queries()
    Dim db As DAO.Database
    Set db = CurrentDb

    RecreateQuery db, "Q_F1_ScrapPieceList", Sql_Q_F1_ScrapPieceList()
    RecreateQuery db, "Q_F4_UsageHistory", Sql_Q_F4_UsageHistory()
    RecreateQuery db, "Q_R1_PickList", Sql_Q_R1_PickList()

    MsgBox "Stage 2 queries created:" & vbCrLf & _
           "- Q_F1_ScrapPieceList" & vbCrLf & _
           "- Q_F4_UsageHistory" & vbCrLf & _
           "- Q_R1_PickList", vbInformation, "W query setup"
End Sub

Public Sub W_CreateStage2Queries_Silent()
    Dim db As DAO.Database
    Set db = CurrentDb

    RecreateQuery db, "Q_F1_ScrapPieceList", Sql_Q_F1_ScrapPieceList()
    RecreateQuery db, "Q_F4_UsageHistory", Sql_Q_F4_UsageHistory()
    RecreateQuery db, "Q_R1_PickList", Sql_Q_R1_PickList()
End Sub

Private Sub RecreateQuery(ByVal db As DAO.Database, ByVal queryName As String, ByVal querySql As String)
    On Error Resume Next
    db.QueryDefs.Delete queryName
    Err.Clear
    On Error GoTo 0

    db.CreateQueryDef queryName, querySql
End Sub

Private Function Sql_Q_F1_ScrapPieceList() As String
    Dim sql As String
    Dim aInv As String
    Dim aMaterial As String
    Dim aStatus As String
    Dim aQuality As String
    Dim aLocation As String
    Dim aArea As String
    Dim aNap As String
    Dim aUpdated As String

    aInv = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.inventoryTag", "Inv tag"), "Inv tag")
    aMaterial = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.material", "Material"), "Material")
    aStatus = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.status", "Status"), "Status")
    aQuality = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.quality", "Quality"), "Quality")
    aLocation = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.location", "Location"), "Location")
    aArea = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.area", "Area, mm2"), "Area, mm2")
    aNap = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.nap", "Nap, deg"), "Nap, deg")
    aUpdated = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.updatedAt", "Updated"), "Updated")

    sql = "SELECT "
    sql = sql & "sp.inventoryTag AS inventoryTagKey, "
    sql = sql & "Nz(fm.materialName,'') AS materialKey, "
    sql = sql & "W_StatusLabel(Nz(sp.scrapStatus,'')) AS statusLabelKey, "
    sql = sql & "Nz(sl.locCode,'') AS locationKey, "
    sql = sql & "sp.inventoryTag AS [" & aInv & "], "
    sql = sql & "fm.materialName AS [" & aMaterial & "], "
    sql = sql & "W_StatusLabel(Nz(sp.scrapStatus,'')) AS [" & aStatus & "], "
    sql = sql & "W_QualityLabel(Nz(sp.scrapQuality,'')) AS [" & aQuality & "], "
    sql = sql & "sl.locCode AS [" & aLocation & "], "
    sql = sql & "sp.areaMm2 AS [" & aArea & "], "
    sql = sql & "sp.napDirectionDeg AS [" & aNap & "], "
    sql = sql & "sp.updatedAt AS [" & aUpdated & "] "
    sql = sql & "FROM (ScrapPiece AS sp "
    sql = sql & "LEFT JOIN FurMaterial AS fm ON sp.materialId = fm.id) "
    sql = sql & "LEFT JOIN StorageLocation AS sl ON sp.storageLocationId = sl.id;"

    Sql_Q_F1_ScrapPieceList = sql
End Function

Private Function Sql_Q_F4_UsageHistory() As String
    Dim aInv As String
    Dim aLayout As String
    Dim aFragment As String
    Dim aRot As String
    Dim aOffX As String
    Dim aOffY As String

    aInv = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f4.col.inventoryTag", "Inv tag"), "Inv tag")
    aLayout = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f4.col.layoutRunId", "Layout run"), "Layout run")
    aFragment = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f4.col.fragmentId", "Fragment"), "Fragment")
    aRot = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f4.col.rotationDeg", "Rotation, deg"), "Rotation, deg")
    aOffX = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f4.col.offsetXmm", "Offset X, mm"), "Offset X, mm")
    aOffY = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f4.col.offsetYmm", "Offset Y, mm"), "Offset Y, mm")

    Sql_Q_F4_UsageHistory = _
        "SELECT " & _
        "sp.inventoryTag AS inventoryTagKey, " & _
        "lrsp.layoutRunId AS layoutRunIdKey, " & _
        "lrsp.fragmentId AS fragmentIdKey, " & _
        "lrsp.rotationDeg AS rotationDegKey, " & _
        "lrsp.offsetXmm AS offsetXmmKey, " & _
        "lrsp.offsetYmm AS offsetYmmKey, " & _
        "sp.inventoryTag AS [" & aInv & "], " & _
        "lrsp.layoutRunId AS [" & aLayout & "], " & _
        "lrsp.fragmentId AS [" & aFragment & "], " & _
        "lrsp.rotationDeg AS [" & aRot & "], " & _
        "lrsp.offsetXmm AS [" & aOffX & "], " & _
        "lrsp.offsetYmm AS [" & aOffY & "] " & _
        "FROM ((LayoutRunScrapPlacement AS lrsp " & _
        "INNER JOIN ScrapPiece AS sp ON lrsp.scrapPieceId = sp.id) " & _
        "INNER JOIN Fragment AS f ON lrsp.fragmentId = f.id) " & _
        "INNER JOIN LayoutRun AS lr ON lrsp.layoutRunId = lr.id;"
End Function

Private Function Sql_Q_R1_PickList() As String
    Dim sql As String
    Dim aInv As String
    Dim aLocation As String
    Dim aMaterial As String
    Dim aStatus As String
    Dim aQuality As String
    Dim aArea As String
    Dim aNap As String

    aInv = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.inventoryTag", "Inv tag"), "Inv tag")
    aLocation = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.location", "Location"), "Location")
    aMaterial = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.material", "Material"), "Material")
    aStatus = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.status", "Status"), "Status")
    aQuality = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.quality", "Quality"), "Quality")
    aArea = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.area", "Area, mm2"), "Area, mm2")
    aNap = W_SafeSqlAlias_FurLab(W_F1_FieldAlias("f1.col.nap", "Nap, deg"), "Nap, deg")

    sql = "SELECT "
    sql = sql & "sp.inventoryTag AS inventoryTagKey, "
    sql = sql & "sl.locCode AS locationKey, "
    sql = sql & "fm.materialName AS materialKey, "
    sql = sql & "W_StatusLabel(Nz(sp.scrapStatus,'')) AS statusKey, "
    sql = sql & "W_QualityLabel(Nz(sp.scrapQuality,'')) AS qualityKey, "
    sql = sql & "sp.areaMm2 AS areaMm2Key, "
    sql = sql & "sp.napDirectionDeg AS napDegKey, "
    sql = sql & "sp.inventoryTag AS [" & aInv & "], "
    sql = sql & "sl.locCode AS [" & aLocation & "], "
    sql = sql & "fm.materialName AS [" & aMaterial & "], "
    sql = sql & "W_StatusLabel(Nz(sp.scrapStatus,'')) AS [" & aStatus & "], "
    sql = sql & "W_QualityLabel(Nz(sp.scrapQuality,'')) AS [" & aQuality & "], "
    sql = sql & "sp.areaMm2 AS [" & aArea & "], "
    sql = sql & "sp.napDirectionDeg AS [" & aNap & "] "
    sql = sql & "FROM (ScrapPiece AS sp "
    sql = sql & "LEFT JOIN StorageLocation AS sl ON sp.storageLocationId = sl.id) "
    sql = sql & "LEFT JOIN FurMaterial AS fm ON sp.materialId = fm.id "
    sql = sql & "WHERE sp.scrapStatus = 'Reserved';"

    Sql_Q_R1_PickList = sql
End Function

Private Function W_UiTextSafe(ByVal captionKey As String, ByVal fallbackText As String) As String
    On Error GoTo Fallback
    Dim langCode As String
    Dim v As Variant
    Dim keyEsc As String

    keyEsc = Replace(captionKey, "'", "''")
    langCode = LCase$(Trim$(Nz(DLookup("cfgValue", "AppConfig", "cfgKey='ui.lang'"), "en")))

    If langCode = "ru" Then
        v = DLookup("textRu", "UiTextDict", "captionKey='" & keyEsc & "'")
        If IsNull(v) Or Len(Trim$(CStr(v))) = 0 Then
            v = DLookup("textEn", "UiTextDict", "captionKey='" & keyEsc & "'")
        End If
    Else
        v = DLookup("textEn", "UiTextDict", "captionKey='" & keyEsc & "'")
        If IsNull(v) Or Len(Trim$(CStr(v))) = 0 Then
            v = DLookup("textRu", "UiTextDict", "captionKey='" & keyEsc & "'")
        End If
    End If

    If IsNull(v) Or Len(Trim$(CStr(v))) = 0 Then
        W_UiTextSafe = fallbackText
    Else
        W_UiTextSafe = CStr(v)
    End If
    Exit Function

Fallback:
    W_UiTextSafe = fallbackText
End Function
