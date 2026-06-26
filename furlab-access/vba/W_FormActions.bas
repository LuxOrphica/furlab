Attribute VB_Name = "W_FormActions"
Option Compare Database
Option Explicit

Public Function W_F1_OnLoad() As Boolean
    On Error GoTo ErrHandler
    Dim frm As Form
    Set frm = Screen.ActiveForm

    On Error Resume Next
    DoCmd.Maximize
    Err.Clear
    On Error GoTo ErrHandler

    EnsureFilterControlRuntimeState frm.Controls("txtFindInventoryTag"), ""
    EnsureFilterControlRuntimeState frm.Controls("cboFilterMaterial"), _
        "SELECT materialName FROM FurMaterial WHERE materialName Is Not Null ORDER BY materialName;"
    EnsureFilterControlRuntimeState frm.Controls("cboFilterStatus"), _
        F1StatusFilterRowSql()
    EnsureFilterControlRuntimeState frm.Controls("cboFilterLocCode"), _
        "SELECT locCode FROM StorageLocation WHERE locCode Is Not Null ORDER BY locCode;"

    frm.Controls("cboFilterMaterial").Requery
    frm.Controls("cboFilterStatus").Requery
    frm.Controls("cboFilterLocCode").Requery
    frm.Controls("txtFindInventoryTag").AfterUpdate = "=W_F1_RequeryFilters()"
    frm.Controls("cboFilterMaterial").AfterUpdate = "=W_F1_RequeryFilters()"
    frm.Controls("cboFilterStatus").AfterUpdate = "=W_F1_RequeryFilters()"
    frm.Controls("cboFilterLocCode").AfterUpdate = "=W_F1_RequeryFilters()"

    On Error Resume Next
    frm.Controls("subScrapPieceList").Form.Requery
    Err.Clear
    On Error GoTo ErrHandler

    W_F1_OnLoad = True
    Exit Function
ErrHandler:
    W_F1_OnLoad = True
End Function

Public Function W_F1_RequeryFilters() As Boolean
    On Error GoTo ErrHandler
    Dim frmHost As Form
    Dim frmList As Form
    Set frmHost = Screen.ActiveForm
    Set frmList = W_F1_GetListForm(frmHost)
    W_F1_ApplyFilters frmHost, frmList
    frmList.Requery
    W_F1_RequeryFilters = True
    Exit Function
ErrHandler:
    MsgBox "F1 filter error: " & Err.Description, vbExclamation, "F1 filters"
    W_F1_RequeryFilters = True
End Function

Public Function W_F1_ApplyFiltersNow() As Boolean
    On Error GoTo ErrHandler
    Dim frmHost As Form
    Dim frmList As Form
    Set frmHost = Screen.ActiveForm
    Set frmList = W_F1_GetListForm(frmHost)
    W_F1_ApplyFilters frmHost, frmList
    frmList.Requery
    W_F1_ApplyFiltersNow = True
    Exit Function
ErrHandler:
    MsgBox "F1 apply filter error: " & Err.Description, vbExclamation, "F1 filters"
    W_F1_ApplyFiltersNow = True
End Function

Public Sub W_F1_RepairFilterCombos()
    On Error GoTo ErrHandler
    Dim frm As Form

    DoCmd.OpenForm "F1_ScrapPieceRegistry", acDesign
    Set frm = Forms("F1_ScrapPieceRegistry")

    FixF1FilterCombo frm.Controls("cboFilterMaterial"), _
                     "SELECT materialName FROM FurMaterial WHERE materialName Is Not Null ORDER BY materialName;"
    FixF1FilterCombo frm.Controls("cboFilterStatus"), _
                     F1StatusFilterRowSql()
    FixF1FilterCombo frm.Controls("cboFilterLocCode"), _
                     "SELECT locCode FROM StorageLocation WHERE locCode Is Not Null ORDER BY locCode;"

    DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes
    DoCmd.OpenForm "F1_ScrapPieceRegistry", acNormal
    MsgBox "F1 filter combos repaired.", vbInformation, "F1 filters"
    Exit Sub

ErrHandler:
    On Error Resume Next
    DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes
    MsgBox "Cannot repair F1 filter combos: " & Err.Description, vbExclamation, "F1 filters"
End Sub

Private Sub FixF1FilterCombo(ByVal ctl As Control, ByVal rowSql As String)
    ctl.ControlSource = ""
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = rowSql
    ctl.ColumnCount = 1
    ctl.BoundColumn = 1
    ctl.LimitToList = False
    ctl.AutoExpand = True
    ctl.Enabled = True
    ctl.Locked = False
    ctl.OnEnter = ""
    ctl.OnExit = ""
    ctl.OnGotFocus = ""
    ctl.OnLostFocus = ""
    ctl.OnChange = ""
    ctl.AfterUpdate = ""
End Sub

Private Sub EnsureFilterControlRuntimeState(ByVal ctl As Control, ByVal rowSql As String)
    On Error Resume Next
    ctl.ControlSource = ""
    ctl.Enabled = True
    ctl.Locked = False
    ctl.TabStop = True
    ctl.OnChange = ""
    ctl.OnEnter = ""
    ctl.OnExit = ""
    ctl.OnGotFocus = ""
    ctl.OnLostFocus = ""
    If ctl.ControlType = acComboBox Then
        ctl.RowSourceType = "Table/Query"
        If Len(rowSql) > 0 Then ctl.RowSource = rowSql
        ctl.ColumnCount = 1
        ctl.BoundColumn = 1
        ctl.LimitToList = False
        ctl.AutoExpand = True
    End If
    Err.Clear
    On Error GoTo 0
End Sub

Public Function W_F1_RepairFilterCombos_Silent() As Boolean
    On Error GoTo ErrHandler
    Dim frm As Form

    DoCmd.OpenForm "F1_ScrapPieceRegistry", acDesign
    Set frm = Forms("F1_ScrapPieceRegistry")

    FixF1FilterCombo frm.Controls("cboFilterMaterial"), _
                     "SELECT materialName FROM FurMaterial WHERE materialName Is Not Null ORDER BY materialName;"
    FixF1FilterCombo frm.Controls("cboFilterStatus"), _
                     F1StatusFilterRowSql()
    FixF1FilterCombo frm.Controls("cboFilterLocCode"), _
                     "SELECT locCode FROM StorageLocation WHERE locCode Is Not Null ORDER BY locCode;"

    DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes
    W_F1_RepairFilterCombos_Silent = True
    Exit Function

ErrHandler:
    On Error Resume Next
    DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes
    W_F1_RepairFilterCombos_Silent = False
End Function

Private Function F1StatusFilterRowSql() As String
    F1StatusFilterRowSql = _
        "SELECT W_StatusLabel(code) AS statusLabel " & _
        "FROM ScrapStatusDict " & _
        "WHERE code Is Not Null " & _
        "ORDER BY code;"
End Function

Public Function W_F1_ResetFilters() As Boolean
    On Error GoTo ExitFn
    Dim frmHost As Form
    Dim frmList As Form
    Set frmHost = Screen.ActiveForm
    Set frmList = W_F1_GetListForm(frmHost)

    frmHost!txtFindInventoryTag = Null
    frmHost!cboFilterMaterial = Null
    frmHost!cboFilterStatus = Null
    frmHost!cboFilterLocCode = Null
    frmList.FilterOn = False
    frmList.Filter = ""
    frmList.Requery

ExitFn:
    W_F1_ResetFilters = True
End Function

Private Sub W_F1_ApplyFilters(ByVal frmHost As Form, ByVal frmList As Form)
    Dim filterText As String
    Dim valText As String

    filterText = ""

    valText = Nz(frmHost!txtFindInventoryTag, "")
    If Len(valText) > 0 Then
        AddFilterClause filterText, "[inventoryTagKey] LIKE '*" & Replace(valText, "'", "''") & "*'"
    End If

    valText = Nz(frmHost!cboFilterMaterial, "")
    If Len(valText) > 0 Then
        AddFilterClause filterText, "[materialKey]='" & Replace(valText, "'", "''") & "'"
    End If

    valText = Nz(frmHost!cboFilterStatus, "")
    If Len(valText) > 0 Then
        AddFilterClause filterText, "[statusLabelKey]='" & Replace(valText, "'", "''") & "'"
    End If

    valText = Nz(frmHost!cboFilterLocCode, "")
    If Len(valText) > 0 Then
        AddFilterClause filterText, "[locationKey]='" & Replace(valText, "'", "''") & "'"
    End If

    If Len(filterText) > 0 Then
        frmList.Filter = filterText
        frmList.FilterOn = True
    Else
        frmList.FilterOn = False
        frmList.Filter = ""
    End If
End Sub

Public Function W_F1_GetListForm(ByVal frmHost As Form) As Form
    If StrComp(frmHost.Name, "SF1_ScrapPieceList", vbTextCompare) = 0 Then
        Set W_F1_GetListForm = frmHost
    Else
        Set W_F1_GetListForm = frmHost.Controls("subScrapPieceList").Form
    End If
End Function

Public Function W_F1_FieldAlias(ByVal captionKey As String, ByVal fallbackText As String) As String
    Select Case LCase$(Trim$(captionKey))
        Case "f1.col.inventorytag"
            W_F1_FieldAlias = UiTextSqlAlias("f1.col.inventoryTag", fallbackText)
        Case "f1.col.material"
            W_F1_FieldAlias = UiTextSqlAlias("f1.col.material", fallbackText)
        Case "f1.col.status"
            W_F1_FieldAlias = UiTextSqlAlias("f1.col.status", fallbackText)
        Case "f1.col.quality"
            W_F1_FieldAlias = UiTextSqlAlias("f1.col.quality", fallbackText)
        Case "f1.col.location"
            W_F1_FieldAlias = UiTextSqlAlias("f1.col.location", fallbackText)
        Case "f1.col.area"
            W_F1_FieldAlias = UiTextSqlAlias("f1.col.area", fallbackText)
        Case "f1.col.nap"
            W_F1_FieldAlias = UiTextSqlAlias("f1.col.nap", fallbackText)
        Case "f1.col.updatedat"
            W_F1_FieldAlias = UiTextSqlAlias("f1.col.updatedAt", fallbackText)
        Case "f4.col.inventorytag"
            W_F1_FieldAlias = UiTextSqlAlias("f4.col.inventoryTag", fallbackText)
        Case "f4.col.layoutrunid"
            W_F1_FieldAlias = UiTextSqlAlias("f4.col.layoutRunId", fallbackText)
        Case "f4.col.fragmentid"
            W_F1_FieldAlias = UiTextSqlAlias("f4.col.fragmentId", fallbackText)
        Case "f4.col.rotationdeg"
            W_F1_FieldAlias = UiTextSqlAlias("f4.col.rotationDeg", fallbackText)
        Case "f4.col.offsetxmm"
            W_F1_FieldAlias = UiTextSqlAlias("f4.col.offsetXmm", fallbackText)
        Case "f4.col.offsetymm"
            W_F1_FieldAlias = UiTextSqlAlias("f4.col.offsetYmm", fallbackText)
        Case Else
            W_F1_FieldAlias = UiTextSqlAlias(captionKey, fallbackText)
    End Select
End Function

Private Function UiTextSqlAlias(ByVal captionKey As String, ByVal fallbackText As String) As String
    Dim s As String
    s = UiText(captionKey, fallbackText)
    s = Replace(s, "[", "(")
    s = Replace(s, "]", ")")
    UiTextSqlAlias = s
End Function

Public Function W_SafeSqlAlias_FurLab(ByVal rawText As String, ByVal fallbackText As String) As String
    Dim s As String
    s = Trim$(rawText)
    If Len(s) = 0 Then s = fallbackText
    s = Replace(s, "[", "(")
    s = Replace(s, "]", ")")
    s = Replace(s, ".", "")
    s = Replace(s, "'", "")
    s = Replace(s, """", "")
    s = Replace(s, ":", "")
    s = Replace(s, ";", "")
    s = Replace(s, "!", "")
    s = Replace(s, "?", "")
    Do While InStr(s, "  ") > 0
        s = Replace(s, "  ", " ")
    Loop
    s = Trim$(s)
    If Len(s) = 0 Then s = fallbackText
    W_SafeSqlAlias_FurLab = s
End Function

Public Function W_F1_OpenCard() As Boolean
    On Error GoTo ErrHandler
    Dim tagValue As String
    Dim frmHost As Form
    Dim frmList As Form
    Set frmHost = Screen.ActiveForm
    Set frmList = W_F1_GetListForm(frmHost)

    tagValue = Trim$(Nz(GetCurrentFieldText(frmList, W_F1_FieldAlias("f1.col.inventoryTag", "Inv tag")), ""))
    If Len(tagValue) = 0 Then tagValue = Trim$(Nz(GetCurrentFieldText(frmList, "inventoryTagKey"), ""))
    If Len(tagValue) = 0 Then tagValue = Trim$(Nz(GetCurrentFieldText(frmList, "inventoryTag"), ""))
    If Len(tagValue) = 0 Then tagValue = Trim$(W_F1_GetCurrentRowFirstField(frmList))

    If Len(tagValue) = 0 Then
        MsgBox "Cannot open card: inventoryTag is empty for current row.", vbExclamation
        GoTo ExitFn
    End If

    DoCmd.OpenForm "F2_ScrapPieceCard", acNormal, , "inventoryTag='" & Replace(tagValue, "'", "''") & "'"
ExitFn:
    W_F1_OpenCard = True
    Exit Function
ErrHandler:
    MsgBox "Cannot open card: " & Err.Description, vbExclamation
    Resume ExitFn
End Function

Private Function W_F1_GetCurrentRowFirstField(ByVal frmList As Form) As String
    On Error GoTo ExitFn
    Dim rs As DAO.Recordset
    Dim v As Variant

    W_F1_GetCurrentRowFirstField = ""
    If frmList Is Nothing Then Exit Function

    Set rs = frmList.RecordsetClone
    If rs Is Nothing Then Exit Function
    If rs.RecordCount = 0 Then GoTo ExitFn

    rs.Bookmark = frmList.Bookmark
    v = rs.Fields(0).Value
    If Not IsNull(v) Then W_F1_GetCurrentRowFirstField = Trim$(CStr(v))

ExitFn:
    On Error Resume Next
    If Not rs Is Nothing Then rs.Close
    Set rs = Nothing
End Function

Public Function W_F1_NewPiece() As Boolean
    On Error GoTo ErrHandler
    If CurrentProject.AllForms("F2_ScrapPieceCard").IsLoaded Then
        DoCmd.Close acForm, "F2_ScrapPieceCard", acSaveNo
    End If
    DoCmd.OpenForm "F2_ScrapPieceCard", acNormal, , , acFormAdd
ExitFn:
    W_F1_NewPiece = True
    Exit Function
ErrHandler:
    MsgBox "Cannot open new card form: " & Err.Description, vbExclamation
    Resume ExitFn
End Function

Public Function W_F2_ReservationUiRefresh() As Boolean
    On Error GoTo ExitFn
    Dim frm As Form
    Dim statusRaw As String
    Dim statusCanon As String
    Dim showReserve As Boolean
    Dim showRelease As Boolean

    Set frm = Screen.ActiveForm
    statusRaw = ""
    On Error Resume Next
    statusRaw = Trim$(Nz(frm.Controls("cbo_scrapStatus").Value, ""))
    If Len(statusRaw) = 0 Then statusRaw = Trim$(Nz(frm.Controls("scrapStatus").Value, ""))
    If Len(statusRaw) = 0 Then statusRaw = Trim$(Nz(GetCurrentFieldText(frm, "scrapStatus"), ""))
    On Error GoTo ExitFn

    statusCanon = NormalizeScrapStatusCode(statusRaw)
    If statusCanon = "NULL_AS_AVAILABLE" Then statusCanon = "Available"
    statusCanon = ResolveStatusCode(statusCanon)
    statusCanon = NormalizeScrapStatusCode(statusCanon)

    showReserve = (StrComp(statusCanon, "Available", vbTextCompare) = 0)
    showRelease = (StrComp(statusCanon, "Reserved", vbTextCompare) = 0)

    On Error Resume Next
    frm.Controls("cmdReleaseFromCard").Left = frm.Controls("cmdReserveFromCard").Left
    frm.Controls("cmdReleaseFromCard").Top = frm.Controls("cmdReserveFromCard").Top
    frm.Controls("cmdReleaseFromCard").Width = frm.Controls("cmdReserveFromCard").Width
    frm.Controls("cmdReleaseFromCard").Height = frm.Controls("cmdReserveFromCard").Height
    frm.Controls("cmdReserveFromCard").Visible = showReserve
    frm.Controls("cmdReleaseFromCard").Visible = showRelease
    frm.Controls("cmdReserveFromCard").Enabled = showReserve
    frm.Controls("cmdReleaseFromCard").Enabled = showRelease
    frm.Repaint
    On Error GoTo ExitFn

ExitFn:
    W_F2_ReservationUiRefresh = True
End Function

Private Function IsStatusLike(ByVal rawStatus As String, ByVal canonicalCode As String) As Boolean
    Dim s As String
    Dim codeNorm As String

    s = LCase$(Trim$(Nz(rawStatus, "")))
    codeNorm = LCase$(Trim$(canonicalCode))

    If Len(s) = 0 Then
        IsStatusLike = False
        Exit Function
    End If

    If s = codeNorm Then
        IsStatusLike = True
        Exit Function
    End If

    Select Case codeNorm
        Case "available"
            If s = "доступен" Then
                IsStatusLike = True
                Exit Function
            End If
        Case "reserved"
            If s = "зарезервирован" Then
                IsStatusLike = True
                Exit Function
            End If
    End Select

    On Error Resume Next
    IsStatusLike = (LCase$(ResolveStatusCode(rawStatus)) = codeNorm)
    On Error GoTo 0
End Function

Public Function W_F2_OnCurrent() As Boolean
    On Error Resume Next
    W_F2_ContourPreviewModeChanged
    W_F2_ReservationUiRefresh
    W_F2_OnCurrent = True
End Function

' Backward-compatible alias for old form event bindings.
Public Function W_F2_ReservationUiSync() As Boolean
    W_F2_ReservationUiSync = W_F2_ReservationUiRefresh()
End Function

Public Function W_GuidNoBraces(ByVal v As Variant) As String
    Dim s As String
    s = Nz(v, "")
    s = Replace(s, "{", "")
    s = Replace(s, "}", "")
    W_GuidNoBraces = s
End Function

Public Function W_F3_ReserveSelected() As Boolean
    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim frm As Form
    Dim tagValue As String
    Dim reservedBy As String
    Dim noteText As String
    Dim pieceId As Variant
    Dim statusVal As String
    Dim statusDb As Variant
    Dim nowVal As String
    Dim fromLocId As Variant
    Dim reservationId As String
    Dim transactionId As String
    Dim codeAvailable As String
    Dim codeReserved As String
    Dim transLocId As Variant
    Dim activeReserveCount As Long
    Dim errNum As Long
    Dim errMsg As String

    On Error GoTo ErrHandler
    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)
    Set frm = Screen.ActiveForm

    tagValue = Nz(frm!txtInventoryTag, "")
    reservedBy = Nz(frm!txtReservedBy, "")
    noteText = Nz(frm!txtNote, "")
    If Len(tagValue) = 0 Then
        MsgBox "Enter inventoryTag.", vbExclamation
        GoTo ExitFn
    End If

    pieceId = DLookup("id", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    If IsNull(pieceId) Then
        MsgBox "ScrapPiece not found by inventoryTag.", vbExclamation
        GoTo ExitFn
    End If

    statusDb = DLookup("scrapStatus", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    statusVal = ResolveStatusCode(statusDb)
    codeAvailable = ResolveStatusCode("Available")
    codeReserved = ResolveStatusCode("Reserved")
    If Len(codeAvailable) = 0 Then codeAvailable = "Available"
    If Len(codeReserved) = 0 Then codeReserved = "Reserved"

    If Len(statusVal) = 0 Or statusVal = "NULL_AS_AVAILABLE" Then
        MsgBox "scrapStatus is empty for this piece. Reservation is allowed only from '" & codeAvailable & "'.", vbExclamation
        GoTo ExitFn
    End If

    If LCase$(statusVal) <> LCase$(codeAvailable) Then
        MsgBox "scrapStatus must be 'Available'. Current: " & IIf(Len(statusVal) = 0, "<NULL>", statusVal), vbExclamation
        GoTo ExitFn
    End If

    activeReserveCount = DCount("*", "ScrapReservation", _
        "releasedAt Is Null AND scrapPieceId IN (SELECT id FROM ScrapPiece WHERE inventoryTag='" & Replace(tagValue, "'", "''") & "')")
    If activeReserveCount > 0 Then
        MsgBox "Active reservation already exists for this piece. Release it first.", vbExclamation
        GoTo ExitFn
    End If

    fromLocId = DLookup("storageLocationId", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    transLocId = ResolveStorageLocationId(fromLocId)
    reservationId = NewGuidToken()
    transactionId = NewGuidToken()
    nowVal = "#" & Format$(Now, "yyyy-mm-dd hh:nn:ss") & "#"

    wrk.BeginTrans

    db.Execute "UPDATE ScrapPiece SET scrapStatus=" & SqlTextOrNull(codeReserved) & ", updatedAt=" & nowVal & _
               " WHERE inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError
    If db.RecordsAffected <> 1 Then
        Err.Raise vbObjectError + 17401, "W_F3_ReserveSelected", "Expected to update exactly 1 ScrapPiece, got " & db.RecordsAffected
    End If

    db.Execute "INSERT INTO ScrapReservation " & _
               "(id, scrapPieceId, layoutRunId, fragmentId, reservedAt, releasedAt, reservedBy, [note]) " & _
               "SELECT " & reservationId & ", sp.id, Null, Null, " & nowVal & ", Null, " & SqlTextOrNull(reservedBy) & ", " & SqlTextOrNull(noteText) & " " & _
               "FROM ScrapPiece AS sp WHERE sp.inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError

    db.Execute "INSERT INTO ScrapTransaction " & _
               "(id, scrapPieceId, transType, transAt, fromLocId, toLocId, statusBefore, statusAfter, [note], sourceRef) " & _
               "SELECT " & transactionId & ", sp.id, 'Reserve', " & nowVal & ", " & SqlIdLiteral(transLocId) & ", " & SqlIdLiteral(transLocId) & ", '" & Replace(statusVal, "'", "''") & "', '" & Replace(codeReserved, "'", "''") & "', " & _
               SqlTextOrNull(noteText) & ", 'F3_ReservationOperation' " & _
               "FROM ScrapPiece AS sp WHERE sp.inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError

    wrk.CommitTrans
    MsgBox "Reserved successfully.", vbInformation

ExitFn:
    W_F3_ReserveSelected = True
    Exit Function

ErrHandler:
    errNum = Err.Number
    errMsg = Err.Description
    On Error Resume Next
    wrk.Rollback
    On Error GoTo 0
    MsgBox "Reservation failed (" & errNum & "): " & errMsg, vbCritical
    Resume ExitFn
End Function

Public Function W_F2_ReserveFromCard() As Boolean
    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim frm As Form
    Dim tagValue As String
    Dim reservedBy As String
    Dim noteText As String
    Dim pieceId As Variant
    Dim statusVal As String
    Dim statusDb As Variant
    Dim nowVal As String
    Dim fromLocId As Variant
    Dim reservationId As String
    Dim transactionId As String
    Dim codeAvailable As String
    Dim codeReserved As String
    Dim transLocId As Variant
    Dim activeReserveCount As Long
    Dim errNum As Long
    Dim errMsg As String

    On Error GoTo ErrHandler
    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)
    Set frm = Screen.ActiveForm

    If frm.Dirty Then DoCmd.RunCommand acCmdSaveRecord

    tagValue = Nz(frm!txt_inventoryTag, "")
    reservedBy = Nz(frm!txtReservedBy, "")
    noteText = Nz(frm!txt_note, "")
    If Len(tagValue) = 0 Then
        MsgBox "Enter inventoryTag.", vbExclamation
        GoTo ExitFn
    End If

    pieceId = DLookup("id", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    If IsNull(pieceId) Then
        MsgBox "ScrapPiece not found by inventoryTag.", vbExclamation
        GoTo ExitFn
    End If

    statusDb = DLookup("scrapStatus", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    statusVal = ResolveStatusCode(statusDb)
    codeAvailable = ResolveStatusCode("Available")
    codeReserved = ResolveStatusCode("Reserved")
    If Len(codeAvailable) = 0 Then codeAvailable = "Available"
    If Len(codeReserved) = 0 Then codeReserved = "Reserved"

    If Len(statusVal) = 0 Or statusVal = "NULL_AS_AVAILABLE" Then
        MsgBox "scrapStatus is empty for this piece. Reservation is allowed only from '" & codeAvailable & "'.", vbExclamation
        GoTo ExitFn
    End If

    If LCase$(statusVal) <> LCase$(codeAvailable) Then
        MsgBox "scrapStatus must be 'Available'. Current: " & IIf(Len(statusVal) = 0, "<NULL>", statusVal), vbExclamation
        GoTo ExitFn
    End If

    activeReserveCount = DCount("*", "ScrapReservation", _
        "releasedAt Is Null AND scrapPieceId IN (SELECT id FROM ScrapPiece WHERE inventoryTag='" & Replace(tagValue, "'", "''") & "')")
    If activeReserveCount > 0 Then
        MsgBox "Active reservation already exists for this piece. Release it first.", vbExclamation
        GoTo ExitFn
    End If

    fromLocId = DLookup("storageLocationId", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    transLocId = ResolveStorageLocationId(fromLocId)
    reservationId = NewGuidToken()
    transactionId = NewGuidToken()
    nowVal = "#" & Format$(Now, "yyyy-mm-dd hh:nn:ss") & "#"

    wrk.BeginTrans

    db.Execute "UPDATE ScrapPiece SET scrapStatus=" & SqlTextOrNull(codeReserved) & ", updatedAt=" & nowVal & _
               " WHERE inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError
    If db.RecordsAffected <> 1 Then
        Err.Raise vbObjectError + 17421, "W_F2_ReserveFromCard", "Expected to update exactly 1 ScrapPiece, got " & db.RecordsAffected
    End If

    db.Execute "INSERT INTO ScrapReservation " & _
               "(id, scrapPieceId, layoutRunId, fragmentId, reservedAt, releasedAt, reservedBy, [note]) " & _
               "SELECT " & reservationId & ", sp.id, Null, Null, " & nowVal & ", Null, " & SqlTextOrNull(reservedBy) & ", " & SqlTextOrNull(noteText) & " " & _
               "FROM ScrapPiece AS sp WHERE sp.inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError

    db.Execute "INSERT INTO ScrapTransaction " & _
               "(id, scrapPieceId, transType, transAt, fromLocId, toLocId, statusBefore, statusAfter, [note], sourceRef) " & _
               "SELECT " & transactionId & ", sp.id, 'Reserve', " & nowVal & ", " & SqlIdLiteral(transLocId) & ", " & SqlIdLiteral(transLocId) & ", '" & Replace(statusVal, "'", "''") & "', '" & Replace(codeReserved, "'", "''") & "', " & _
               SqlTextOrNull(noteText) & ", 'F2_ScrapPieceCard' " & _
               "FROM ScrapPiece AS sp WHERE sp.inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError

    wrk.CommitTrans
    If CurrentProject.AllForms("F2_ScrapPieceCard").IsLoaded Then Forms("F2_ScrapPieceCard").Requery
    MsgBox "Reserved successfully.", vbInformation

ExitFn:
    W_F2_ReserveFromCard = True
    Exit Function

ErrHandler:
    errNum = Err.Number
    errMsg = Err.Description
    On Error Resume Next
    wrk.Rollback
    On Error GoTo 0
    MsgBox "Reservation failed (" & errNum & "): " & errMsg, vbCritical
    Resume ExitFn
End Function

Public Function W_F3_ReleaseSelected() As Boolean
    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim frm As Form
    Dim tagValue As String
    Dim noteText As String
    Dim statusDb As Variant
    Dim statusVal As String
    Dim codeAvailable As String
    Dim codeReserved As String
    Dim fromLocId As Variant
    Dim transLocId As Variant
    Dim transactionId As String
    Dim nowVal As String
    Dim errNum As Long
    Dim errMsg As String

    On Error GoTo ErrHandler
    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)
    Set frm = Screen.ActiveForm

    tagValue = Nz(frm!txtInventoryTag, "")
    noteText = Nz(frm!txtNote, "")
    If Len(tagValue) = 0 Then
        MsgBox "Enter inventoryTag.", vbExclamation
        GoTo ExitFn
    End If

    If IsNull(DLookup("id", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")) Then
        MsgBox "ScrapPiece not found by inventoryTag.", vbExclamation
        GoTo ExitFn
    End If

    statusDb = DLookup("scrapStatus", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    statusVal = ResolveStatusCode(statusDb)
    codeAvailable = ResolveStatusCode("Available")
    codeReserved = ResolveStatusCode("Reserved")
    If Len(codeAvailable) = 0 Then codeAvailable = "Available"
    If Len(codeReserved) = 0 Then codeReserved = "Reserved"

    If LCase$(statusVal) <> LCase$(codeReserved) Then
        MsgBox "scrapStatus must be 'Reserved'. Current: " & IIf(Len(statusVal) = 0, "<NULL>", statusVal), vbExclamation
        GoTo ExitFn
    End If

    fromLocId = DLookup("storageLocationId", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    transLocId = ResolveStorageLocationId(fromLocId)
    transactionId = NewGuidToken()
    nowVal = "#" & Format$(Now, "yyyy-mm-dd hh:nn:ss") & "#"

    wrk.BeginTrans

    db.Execute "UPDATE ScrapPiece SET scrapStatus=" & SqlTextOrNull(codeAvailable) & ", updatedAt=" & nowVal & _
               " WHERE inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError
    If db.RecordsAffected <> 1 Then
        Err.Raise vbObjectError + 17411, "W_F3_ReleaseSelected", "Expected to update exactly 1 ScrapPiece, got " & db.RecordsAffected
    End If

    db.Execute "UPDATE ScrapReservation SET releasedAt=" & nowVal & _
               " WHERE releasedAt Is Null AND scrapPieceId IN (SELECT id FROM ScrapPiece WHERE inventoryTag='" & Replace(tagValue, "'", "''") & "')", dbFailOnError

    db.Execute "INSERT INTO ScrapTransaction " & _
               "(id, scrapPieceId, transType, transAt, fromLocId, toLocId, statusBefore, statusAfter, [note], sourceRef) " & _
               "SELECT " & transactionId & ", sp.id, 'Release', " & nowVal & ", " & SqlIdLiteral(transLocId) & ", " & SqlIdLiteral(transLocId) & ", '" & Replace(codeReserved, "'", "''") & "', '" & Replace(codeAvailable, "'", "''") & "', " & _
               SqlTextOrNull(noteText) & ", 'F3_ReleaseReservation' " & _
               "FROM ScrapPiece AS sp WHERE sp.inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError

    wrk.CommitTrans
    MsgBox "Released successfully.", vbInformation

ExitFn:
    W_F3_ReleaseSelected = True
    Exit Function

ErrHandler:
    errNum = Err.Number
    errMsg = Err.Description
    On Error Resume Next
    wrk.Rollback
    On Error GoTo 0
    MsgBox "Release failed (" & errNum & "): " & errMsg, vbCritical
    Resume ExitFn
End Function

Public Function W_F2_ReleaseFromCard() As Boolean
    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim frm As Form
    Dim tagValue As String
    Dim noteText As String
    Dim statusDb As Variant
    Dim statusVal As String
    Dim codeAvailable As String
    Dim codeReserved As String
    Dim fromLocId As Variant
    Dim transLocId As Variant
    Dim transactionId As String
    Dim nowVal As String
    Dim errNum As Long
    Dim errMsg As String

    On Error GoTo ErrHandler
    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)
    Set frm = Screen.ActiveForm

    If frm.Dirty Then DoCmd.RunCommand acCmdSaveRecord

    tagValue = Nz(frm!txt_inventoryTag, "")
    noteText = Nz(frm!txt_note, "")
    If Len(tagValue) = 0 Then
        MsgBox "Enter inventoryTag.", vbExclamation
        GoTo ExitFn
    End If

    If IsNull(DLookup("id", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")) Then
        MsgBox "ScrapPiece not found by inventoryTag.", vbExclamation
        GoTo ExitFn
    End If

    statusDb = DLookup("scrapStatus", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    statusVal = ResolveStatusCode(statusDb)
    codeAvailable = ResolveStatusCode("Available")
    codeReserved = ResolveStatusCode("Reserved")
    If Len(codeAvailable) = 0 Then codeAvailable = "Available"
    If Len(codeReserved) = 0 Then codeReserved = "Reserved"

    If LCase$(statusVal) <> LCase$(codeReserved) Then
        MsgBox "scrapStatus must be 'Reserved'. Current: " & IIf(Len(statusVal) = 0, "<NULL>", statusVal), vbExclamation
        GoTo ExitFn
    End If

    fromLocId = DLookup("storageLocationId", "ScrapPiece", "inventoryTag='" & Replace(tagValue, "'", "''") & "'")
    transLocId = ResolveStorageLocationId(fromLocId)
    transactionId = NewGuidToken()
    nowVal = "#" & Format$(Now, "yyyy-mm-dd hh:nn:ss") & "#"

    wrk.BeginTrans

    db.Execute "UPDATE ScrapPiece SET scrapStatus=" & SqlTextOrNull(codeAvailable) & ", updatedAt=" & nowVal & _
               " WHERE inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError
    If db.RecordsAffected <> 1 Then
        Err.Raise vbObjectError + 17431, "W_F2_ReleaseFromCard", "Expected to update exactly 1 ScrapPiece, got " & db.RecordsAffected
    End If

    db.Execute "UPDATE ScrapReservation SET releasedAt=" & nowVal & _
               " WHERE releasedAt Is Null AND scrapPieceId IN (SELECT id FROM ScrapPiece WHERE inventoryTag='" & Replace(tagValue, "'", "''") & "')", dbFailOnError

    db.Execute "INSERT INTO ScrapTransaction " & _
               "(id, scrapPieceId, transType, transAt, fromLocId, toLocId, statusBefore, statusAfter, [note], sourceRef) " & _
               "SELECT " & transactionId & ", sp.id, 'Release', " & nowVal & ", " & SqlIdLiteral(transLocId) & ", " & SqlIdLiteral(transLocId) & ", '" & Replace(codeReserved, "'", "''") & "', '" & Replace(codeAvailable, "'", "''") & "', " & _
               SqlTextOrNull(noteText) & ", 'F2_ScrapPieceCard' " & _
               "FROM ScrapPiece AS sp WHERE sp.inventoryTag='" & Replace(tagValue, "'", "''") & "'", dbFailOnError

    wrk.CommitTrans
    If CurrentProject.AllForms("F2_ScrapPieceCard").IsLoaded Then Forms("F2_ScrapPieceCard").Requery
    MsgBox "Released successfully.", vbInformation

ExitFn:
    W_F2_ReleaseFromCard = True
    Exit Function

ErrHandler:
    errNum = Err.Number
    errMsg = Err.Description
    On Error Resume Next
    wrk.Rollback
    On Error GoTo 0
    MsgBox "Release failed (" & errNum & "): " & errMsg, vbCritical
    Resume ExitFn
End Function

Public Function W_F4_ApplyFilter() As Boolean
    On Error GoTo ExitFn
    Dim frm As Form
    Dim tagValue As String
    Set frm = Screen.ActiveForm
    tagValue = Nz(frm!txtFilterInventoryTag, "")
    If Len(tagValue) > 0 Then
        frm.Filter = "[" & W_F1_FieldAlias("f4.col.inventoryTag", "Inv tag") & "] LIKE '*" & Replace(tagValue, "'", "''") & "*'"
        frm.FilterOn = True
    Else
        frm.FilterOn = False
        frm.Filter = ""
    End If
ExitFn:
    W_F4_ApplyFilter = True
End Function

Public Function W_F4_ClearFilter() As Boolean
    On Error GoTo ExitFn
    Dim frm As Form
    Set frm = Screen.ActiveForm
    frm!txtFilterInventoryTag = Null
    frm.FilterOn = False
    frm.Filter = ""
ExitFn:
    W_F4_ClearFilter = True
End Function

Private Function NormalizeScrapStatusCode(ByVal v As Variant) As String
    Dim s As String
    s = Trim$(Nz(v, ""))
    If Len(s) = 0 Then
        NormalizeScrapStatusCode = "NULL_AS_AVAILABLE"
        Exit Function
    End If

    Select Case LCase$(s)
        Case "available"
            NormalizeScrapStatusCode = "Available"
        Case "reserved"
            NormalizeScrapStatusCode = "Reserved"
        Case "used"
            NormalizeScrapStatusCode = "Used"
        Case "discarded"
            NormalizeScrapStatusCode = "Discarded"
        Case LCase$(W_StatusLabel("Available"))
            NormalizeScrapStatusCode = "Available"
        Case LCase$(W_StatusLabel("Reserved"))
            NormalizeScrapStatusCode = "Reserved"
        Case LCase$(W_StatusLabel("Used"))
            NormalizeScrapStatusCode = "Used"
        Case LCase$(W_StatusLabel("Discarded"))
            NormalizeScrapStatusCode = "Discarded"
        Case Else
            NormalizeScrapStatusCode = s
    End Select
End Function

Private Function ResolveStatusCode(ByVal statusValue As Variant) As String
    Dim raw As String
    Dim canon As String
    Dim lbl As String
    Dim code As Variant

    raw = Trim$(Nz(statusValue, ""))
    If Len(raw) = 0 Then Exit Function

    canon = NormalizeScrapStatusCode(raw)
    If canon = "NULL_AS_AVAILABLE" Then canon = "Available"
    If Len(canon) = 0 Then canon = raw
    lbl = W_StatusLabel(canon)

    code = DLookup("code", "ScrapStatusDict", "[code]='" & Replace(raw, "'", "''") & "'")
    If Not IsNull(code) Then
        ResolveStatusCode = CStr(code)
        Exit Function
    End If

    code = DLookup("code", "ScrapStatusDict", "[code]='" & Replace(canon, "'", "''") & "'")
    If Not IsNull(code) Then
        ResolveStatusCode = CStr(code)
        Exit Function
    End If

    If Len(lbl) > 0 Then
        code = DLookup("code", "ScrapStatusDict", "[descr]='" & Replace(lbl, "'", "''") & "'")
        If Not IsNull(code) Then
            ResolveStatusCode = CStr(code)
            Exit Function
        End If
    End If

    code = DLookup("code", "ScrapStatusDict", "[descr]='" & Replace(raw, "'", "''") & "'")
    If Not IsNull(code) Then
        ResolveStatusCode = CStr(code)
        Exit Function
    End If

    ResolveStatusCode = canon
End Function

Private Function SqlIdLiteral(ByVal idValue As Variant) As String
    Dim s As String
    If IsNull(idValue) Then
        SqlIdLiteral = "Null"
        Exit Function
    End If

    If IsNumeric(idValue) Then
        SqlIdLiteral = Trim$(CStr(idValue))
        Exit Function
    End If

    s = Trim$(CStr(idValue))
    If Len(s) = 0 Then
        SqlIdLiteral = "Null"
        Exit Function
    End If

    If InStr(1, s, "-", vbTextCompare) > 0 Or InStr(1, s, "{", vbTextCompare) > 0 Or InStr(1, s, "}", vbTextCompare) > 0 Then
        s = Replace(s, "{", "")
        s = Replace(s, "}", "")
        SqlIdLiteral = "'{" & Replace(s, "'", "''") & "}'"
    Else
        SqlIdLiteral = "'" & Replace(s, "'", "''") & "'"
    End If
End Function

Private Function ResolveStorageLocationId(ByVal locValue As Variant) As Variant
    Dim raw As String
    Dim v As Variant

    If IsNull(locValue) Then
        ResolveStorageLocationId = Null
        Exit Function
    End If

    raw = Trim$(CStr(locValue))
    If Len(raw) = 0 Then
        ResolveStorageLocationId = Null
        Exit Function
    End If

    ' 1) Already a valid id in StorageLocation.id
    v = DLookup("id", "StorageLocation", "id=" & SqlIdLiteral(raw))
    If Not IsNull(v) Then
        ResolveStorageLocationId = v
        Exit Function
    End If

    ' 2) Sometimes ScrapPiece keeps locCode (e.g. BOX-01) instead of GUID
    v = DLookup("id", "StorageLocation", "locCode='" & Replace(raw, "'", "''") & "'")
    If Not IsNull(v) Then
        ResolveStorageLocationId = v
        Exit Function
    End If

    ResolveStorageLocationId = Null
End Function

Private Sub AddFilterClause(ByRef filterText As String, ByVal clause As String)
    If Len(filterText) > 0 Then filterText = filterText & " AND "
    filterText = filterText & clause
End Sub

Public Function SqlTextOrNull(ByVal valueText As String) As String
    If Len(Trim$(valueText)) = 0 Then
        SqlTextOrNull = "Null"
    Else
        SqlTextOrNull = "'" & Replace(valueText, "'", "''") & "'"
    End If
End Function

Public Function NewGuidToken() As String
    NewGuidToken = "'{" & GenerateGuidLike() & "}'"
End Function

Private Function GenerateGuidLike() As String
    Static seeded As Boolean
    Dim s As String
    Dim i As Long

    If Not seeded Then
        Randomize Timer
        seeded = True
    End If

    s = ""
    For i = 1 To 32
        s = s & Mid$("0123456789abcdef", Int(Rnd() * 16) + 1, 1)
    Next i

    Mid$(s, 13, 1) = "4"
    Mid$(s, 17, 1) = Mid$("89ab", Int(Rnd() * 4) + 1, 1)
    GenerateGuidLike = Left$(s, 8) & "-" & Mid$(s, 9, 4) & "-" & Mid$(s, 13, 4) & "-" & Mid$(s, 17, 4) & "-" & Right$(s, 12)
End Function

Public Function QuoteGuid(ByVal guidValue As Variant) As String
    Dim s As String
    s = CStr(guidValue)
    s = Replace(s, "{", "")
    s = Replace(s, "}", "")
    QuoteGuid = "'{" & s & "}'"
End Function

Public Function QuoteGuidOrNull(ByVal guidValue As Variant) As String
    If IsNull(guidValue) Then
        QuoteGuidOrNull = "Null"
    Else
        QuoteGuidOrNull = QuoteGuid(guidValue)
    End If
End Function
